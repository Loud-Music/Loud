import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import { storedAudio } from "./library";
export const isDesktop = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export interface CatalogAlbum {
  id: string;
  title: string;
  artist: string;
  cover: string;
  license: string;
  tags?: string[];
  live?: boolean;
}
interface ArchiveFile {
  name: string;
  format?: string;
  title?: string;
  artist?: string;
  length?: string;
  size?: string;
  private?: string | boolean;
  original?: string;
  bitrate?: string;
}
interface Metadata {
  metadata: {
    title?: string;
    creator?: string | string[];
    licenseurl?: string | string[];
    subject?: string | string[];
    collection?: string | string[];
    mediatype?: string;
    "access-restricted-item"?: string;
  };
  files: ArchiveFile[];
  is_dark?: boolean;
}
function text(value: string | string[] | undefined, fallback = "") {
  return Array.isArray(value) ? value.join(", ") : value || fallback;
}
export function openLicense(url: string) {
  return /^https?:\/\/(www\.)?creativecommons\.org\/(licenses|publicdomain)\//i.test(
    url,
  );
}
async function archiveJSON<T>(path: string): Promise<T> {
  if (isDesktop()) return invoke<T>("archive_json", { path });
  const response = await fetch(
    `${import.meta.env.DEV ? "/archive-api" : "https://archive.org"}${path}`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok)
    throw new Error(
      `Internet Archive returned ${response.status}. Try again shortly.`,
    );
  return response.json();
}
export async function searchCatalog(
  query: string,
  page = 1,
  format: "all" | "FLAC" = "all",
  collection: "netlabels" | "etree" = "netlabels",
): Promise<{ albums: CatalogAlbum[]; total: number }> {
  const escaped = query
    .trim()
    .replace(/[+\-!(){}\[\]^"~*?:\\/]/g, " ")
    .trim();
  const params = new URLSearchParams({
    q: `collection:${collection} AND mediatype:${collection === "etree" ? "etree" : "audio"} AND ${format === "FLAC" ? '(format:Flac OR format:"24bit Flac")' : '(format:Flac OR format:"24bit Flac" OR format:"VBR MP3" OR format:"128Kbps MP3" OR format:MP3)'}${collection === "netlabels" ? " AND licenseurl:*creativecommons*" : ""}${
      escaped ? ` AND "${escaped}"` : ""
    }`,
    output: "json",
    rows: "15",
    page: String(page),
    sort: escaped ? "downloads desc" : "week desc",
  });
  ["identifier", "title", "creator", "licenseurl", "subject"].forEach((field) =>
    params.append("fl[]", field),
  );
  const data = await archiveJSON<{
    response?: {
      docs?: {
        identifier: string;
        title: string;
        creator?: string | string[];
        licenseurl?: string | string[];
        subject?: string | string[];
      }[];
      numFound?: number;
    };
  }>(`/advancedsearch.php?${params}`);
  if (!data.response?.docs)
    throw new Error("Archive returned an invalid search response.");
  return {
    total: data.response.numFound || 0,
    albums: data.response.docs
      .filter(
        (item) => collection === "etree" || openLicense(text(item.licenseurl)),
      )
      .map((item) => ({
        id: item.identifier,
        title: item.title,
        artist: text(item.creator, "Various Artists"),
        cover: `https://archive.org/services/img/${encodeURIComponent(item.identifier)}`,
        license: text(item.licenseurl).replace(/^http:/, "https:"),
        live: collection === "etree",
        tags: text(item.subject)
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean),
      })),
  };
}
function duration(value = "") {
  return value.includes(":")
    ? value.split(":").reduce((seconds, part) => seconds * 60 + Number(part), 0)
    : Number(value) || 0;
}
export async function albumTracks(album: CatalogAlbum): Promise<Track[]> {
  const data = await archiveJSON<Metadata>(
    `/metadata/${encodeURIComponent(album.id)}`,
  );
  return archiveTracks(data, album);
}
function archiveTracks(data: Metadata, album: CatalogAlbum): Track[] {
  const license = text(data.metadata?.licenseurl);
  const collections = Array.isArray(data.metadata?.collection)
    ? data.metadata.collection
    : [data.metadata?.collection || ""];
  const live =
    album.live === true &&
    collections.includes("etree") &&
    data.metadata.mediatype === "etree";
  const streamOnly =
    collections.includes("stream_only") ||
    data.metadata["access-restricted-item"] === "true";
  if (data.is_dark || (!openLicense(license) && !live))
    throw new Error(
      "This release is unavailable or does not declare an open license.",
    );
  const files = data.files || [];
  const byName = new Map(files.map((file) => [file.name, file]));
  function original(file: ArchiveFile) {
    const seen = new Set<string>();
    while (file.original && !seen.has(file.name)) {
      seen.add(file.name);
      const parent = byName.get(file.original);
      if (!parent) return file.original;
      file = parent;
    }
    return file.name;
  }
  const variants = new Map<string, ArchiveFile>();
  const score = (file: ArchiveFile) =>
    /\.flac$/i.test(file.name)
      ? 1000000
      : Number(file.bitrate || file.size || 0);
  files
    .filter(
      (file) =>
        /\.(flac|mp3)$/i.test(file.name) &&
        !file.private &&
        Number(file.size || 0) > 0 &&
        !(streamOnly && /\.flac$/i.test(file.name)) &&
        !(
          /\.flac$/i.test(file.name) &&
          /\.(mp3|ogg|m4a|aac)$/i.test(original(file))
        ),
    )
    .forEach((file) => {
      const key = original(file)
        .replace(/\.[^.]+$/, "")
        .toLowerCase();
      const previous = variants.get(key);
      if (
        !previous ||
        (/\.flac$/i.test(file.name) && !/\.flac$/i.test(previous.name)) ||
        (/\.flac$/i.test(file.name) === /\.flac$/i.test(previous.name) &&
          score(file) > score(previous))
      )
        variants.set(key, file);
    });
  return [...variants.values()].map((file) => {
    const url = `https://archive.org/download/${encodeURIComponent(album.id)}/${file.name.split("/").map(encodeURIComponent).join("/")}`;
    return {
      id: `archive:${album.id}:${file.name}`,
      title:
        file.title ||
        file.name.replace(/\.(flac|mp3)$/i, "").replace(/_/g, " "),
      artist: file.artist || text(data.metadata.creator, album.artist),
      album: data.metadata.title || album.title,
      duration: duration(file.length),
      cover: album.cover,
      source: live ? "Live Music Archive" : "Archive",
      format: /\.flac$/i.test(file.name) ? "FLAC" : "MP3",
      downloadAllowed: !streamOnly,
      src:
        import.meta.env.DEV && !isDesktop()
          ? url.replace("https://archive.org", "/archive-api")
          : url,
      remoteUrl: url,
      license: license
        ? license.replace(/^http:/, "https:")
        : `https://archive.org/details/${encodeURIComponent(collections.find((c) => !["etree", "stream_only"].includes(c) && !c.startsWith("fav-")) || album.id)}?tab=about`,
      attributionUrl: `https://archive.org/details/${encodeURIComponent(album.id)}`,
      tags: text(data.metadata.subject)
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .concat(album.tags || []),
    };
  });
}
interface CachedAudio {
  key: string;
  path: string;
  size: number;
}
const keyCache = new Map<string, string>();
export async function prepareExclusive(track: Track): Promise<string> {
  if (track.format !== "FLAC")
    throw new Error(
      "Для эксклюзивного режима нужен FLAC. Выберите его в каталоге или импортируйте файл.",
    );
  if (track.nativeKey) return track.nativeKey;
  const existing = keyCache.get(track.id);
  if (
    existing &&
    (await invoke<boolean>("audio_cache_contains", { key: existing }))
  )
    return existing;
  if (existing) keyCache.delete(track.id);
  let cache: CachedAudio;
  if (track.remoteUrl)
    cache = await invoke<CachedAudio>("cache_catalog_audio", {
      url: track.remoteUrl,
    });
  else {
    if (!track.src) throw new Error("У этой записи нет аудиофайла.");
    const blob = await storedAudio(track.id);
    const bytes = blob
      ? await blob.arrayBuffer()
      : await fetch(track.src).then((response) => {
          if (!response.ok)
            throw new Error("Не удалось прочитать локальный FLAC.");
          return response.arrayBuffer();
        });
    cache = await invoke<CachedAudio>(
      "cache_local_flac",
      new Uint8Array(bytes),
    );
  }
  keyCache.set(track.id, cache.key);
  return cache.key;
}
