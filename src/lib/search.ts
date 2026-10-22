import { sourcePriority } from "./sourcePriority";
import { albumTracks, openLicense, searchCatalog } from "./catalog";
import type { Track } from "./library";
import { recordingKey } from "./library";
import { catalogJSON } from "./catalogRequest";
import { searchMixter, searchJamendo } from "./additionalCatalogs";
import { searchExtracted, searchLucida } from "./extractor";
import { tasteGenres } from "./recommendations";

export const providers = [
  "Archive",
  "Live Music Archive",
  "Audius",
  "ccMixter",
  "Jamendo",
  "Wikimedia",
  "SoundCloud",
  "Lucida",
] as const;
export type Provider = (typeof providers)[number];
interface SearchResult {
  tracks: Track[];
  unavailable: Provider[];
}

interface AudiusTrack {
  id: string;
  title: string;
  duration: number;
  genre?: string;
  tags?: string;
  artwork?: Record<string, string>;
  user: { name: string };
  permalink?: string;
  is_streamable?: boolean;
  is_available?: boolean;
  is_stream_gated?: boolean;
  access?: { stream?: boolean };
  license?: string;
}

function audiusTracks(items: AudiusTrack[]): Track[] {
  return items
    .filter(
      (t) =>
        t.is_streamable !== false &&
        t.is_available !== false &&
        !t.is_stream_gated &&
        t.access?.stream !== false &&
        t.duration > 30,
    )
    .map((t) => ({
      id: `audius:${t.id}`,
      title: t.title,
      artist: t.user.name,
      album: t.title,
      duration: t.duration,
      cover:
        t.artwork?.["480x480"] ||
        t.artwork?.["150x150"] ||
        "/covers/imported.svg",
      source: "Audius",
      format: "MP3",
      src: `https://api.audius.co/v1/tracks/${encodeURIComponent(t.id)}/stream?app_name=loud`,
      downloadAllowed: false,
      attributionUrl: t.permalink
        ? `https://audius.co${t.permalink}`
        : `https://audius.co`,
      license: t.license || undefined,
      genre: t.genre,
      tags: (t.tags || "").split(",").filter(Boolean),
    }));
}

export async function searchAudius(query: string): Promise<Track[]> {
  const params = new URLSearchParams({ query, limit: "30", app_name: "loud" });
  const data = await catalogJSON<{ data: AudiusTrack[] }>(
    "audius",
    `/v1/tracks/search?${params}`,
  );
  if (!Array.isArray(data.data)) throw new Error("Invalid Audius response");
  return audiusTracks(data.data);
}

interface CommonsImage {
  url: string;
  descriptionurl: string;
  duration?: number;
  mime: string;
  extmetadata?: Record<string, { value: string }>;
}
interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: CommonsImage[];
}
function plain(value = "") {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
function commonsTracks(pages: CommonsPage[]): Track[] {
  return pages.flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info || !/\.(flac|mp3)(?:\?|$)/i.test(info.url)) return [];
    const metadata = info.extmetadata || {};
    const categories = plain(metadata.Categories?.value || "");
    if (
      (info.duration || 0) < 30 ||
      !/music|songs|singing|jazz|classical|orchestral|piano|concert/i.test(
        categories,
      ) ||
      /pronunciation|spoken|speech|sound effects|freesound|dictionary/i.test(
        `${categories} ${page.title}`,
      )
    )
      return [];
    const license = metadata.LicenseUrl?.value || "";
    const publicDomain = /^(pd|cc0)|public domain/i.test(
      metadata.LicenseShortName?.value || "",
    );
    if (!openLicense(license) && !publicDomain) return [];
    const url = new URL(info.url);
    if (url.protocol !== "https:" || url.hostname !== "upload.wikimedia.org")
      return [];
    url.search = "";
    return [
      {
        id: `wikimedia:${page.pageid}`,
        title:
          plain(metadata.ObjectName?.value) ||
          page.title.replace(/^File:/, "").replace(/\.[^.]+$/, ""),
        artist: plain(metadata.Artist?.value) || "Wikimedia Commons",
        album:
          plain(metadata.ObjectName?.value) ||
          page.title.replace(/^File:/, "").replace(/\.[^.]+$/, ""),
        duration: info.duration || 0,
        source: "Wikimedia" as const,
        cover: "/covers/imported.svg",
        format: /\.flac$/i.test(url.pathname) ? "FLAC" : "MP3",
        src: url.href,
        remoteUrl: url.href,
        downloadAllowed: true,
        license: license
          ? license.replace(/^http:/, "https:")
          : "https://commons.wikimedia.org/wiki/Commons:Public_domain",
        attributionUrl: info.descriptionurl,
        tags: plain(metadata.Categories?.value).split("|").filter(Boolean),
      },
    ];
  });
}
export async function searchCommons(query: string): Promise<Track[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `filetype:audio ${query.replace(/[{}|\[\]]/g, " ")} music (flac OR mp3)`,
    gsrnamespace: "6",
    gsrlimit: "30",
    prop: "imageinfo",
    iiprop: "url|mime|size|extmetadata",
  });
  const data = await catalogJSON<{
    query?: { pages?: Record<string, CommonsPage> };
    error?: unknown;
  }>("wikimedia", `/w/api.php?${params}`);
  if (data.error) throw new Error("Wikimedia search is unavailable");
  return commonsTracks(Object.values(data.query?.pages || {}));
}

async function searchArchiveTracks(
  query: string,
  live = false,
): Promise<Track[]> {
  const batches = await Promise.allSettled([
    searchCatalog(query, 1, "FLAC", live ? "etree" : "netlabels"),
    searchCatalog(query, 1, "all", live ? "etree" : "netlabels"),
  ]);
  if (batches.every((result) => result.status === "rejected"))
    throw new Error("Archive search is unavailable");
  const albums = [
    ...new Map(
      batches
        .flatMap((result) =>
          result.status === "fulfilled" ? result.value.albums : [],
        )
        .map((album) => [album.id, album]),
    ).values(),
  ].slice(0, 10);
  const output: Track[] = [];
  for (let i = 0; i < albums.length; i += 5) {
    const batch = await Promise.allSettled(
      albums.slice(i, i + 5).map(albumTracks),
    );
    output.push(
      ...batch.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
    );
  }
  return output;
}

const adapters: Record<Provider, (query: string) => Promise<Track[]>> = {
  Archive: searchArchiveTracks,
  "Live Music Archive": (query) => searchArchiveTracks(query, true),
  Audius: searchAudius,
  Wikimedia: searchCommons,
  ccMixter: searchMixter,
  Jamendo: searchJamendo,
  SoundCloud: searchExtracted,
  Lucida: searchLucida,
};

export function mergeSearch(tracks: Track[], query: string): Track[] {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const term = normalize(query);
  const tokens = term.split(" ").filter(Boolean);
  const genreQuery = [
    ...tasteGenres,
    "chill",
    "chillout",
    "lofi",
    "lo fi",
    "blues",
    "pop",
    "metal",
    "reggae",
    "dance",
    "instrumental",
  ].some((genre) => normalize(genre) === term);
  function matches(words: string, token: string) {
    return words
      .split(" ")
      .some(
        (word) =>
          word === token || (token.length >= 3 && word.startsWith(token)),
      );
  }
  function relevance(track: Track) {
    if (track.source === "Wikimedia" && track.duration < 30) return -1;
    const title = normalize(track.title).replace(/^\d+\s+/, "");
    const artist = normalize(track.artist);
    const album = normalize(track.album);
    const main = `${title} ${artist} ${album}`;
    const tags = normalize(
      `${track.genre || ""} ${(track.tags || []).join(" ")}`,
    );
    if (
      tokens.some(
        (token) =>
          !matches(main, token) && !(genreQuery && matches(tags, token)),
      )
    )
      return -1;
    if (!tokens.length) return 0;
    const titleMatch =
      title === term
        ? 1000
        : title.startsWith(term)
          ? 900
          : title.includes(term)
            ? 800
            : 0;
    const artistMatch =
      artist === term ? 950 : artist.startsWith(term) ? 850 : 0;
    return Math.max(
      tokens.length >= 3 &&
        (`${artist} ${title}` === term || `${title} ${artist}` === term)
        ? 1200
        : 0,
      titleMatch,
      artistMatch,
      tokens.filter((token) => matches(`${title} ${artist}`, token)).length *
        100,
      genreQuery ? 40 : 0,
    );
  }
  const quality = (track: Track) =>
    (track.preview ? 0 : 10) +
    (track.format === "FLAC"
      ? 5
      : track.qualityHint === "lossless"
        ? 3
        : track.format === "MP3"
          ? 2
          : track.format === "AAC"
            ? 1
            : 0) +
    (track.downloaded ? 1 : 0);
  const unique = new Map<string, Track>();
  for (const track of tracks) {
    if (track.preview) continue;
    if (relevance(track) < 0) continue;
    const key = recordingKey(track);
    const previous = unique.get(key);
    if (!previous) unique.set(key, track);
    else {
      const winner =
        quality(track) > quality(previous) ||
        (quality(track) === quality(previous) &&
          sourcePriority(track) < sourcePriority(previous))
          ? track
          : previous;
      const variants = [
        ...(previous.alternatives || []),
        ...(track.alternatives || []),
        ...(previous.extractorUrl
          ? [
              {
                url: previous.extractorUrl,
                duration: previous.duration,
                quality: previous.qualityHint,
              },
            ]
          : []),
        ...(track.extractorUrl
          ? [
              {
                url: track.extractorUrl,
                duration: track.duration,
                quality: track.qualityHint,
              },
            ]
          : []),
      ].filter((c) => Math.abs(c.duration - winner.duration) <= 3);
      unique.set(key, {
        ...winner,
        alternatives: [...new Map(variants.map((c) => [c.url, c])).values()],
      });
    }
  }
  return [...unique.values()].sort(
    (a, b) =>
      relevance(b) - relevance(a) ||
      quality(b) - quality(a) ||
      sourcePriority(a) - sourcePriority(b),
  );
}

export async function searchTracks(
  query: string,
  enabled: readonly Provider[] = providers,
  onUpdate?: (result: SearchResult) => void,
): Promise<SearchResult> {
  const found: Track[][] = enabled.map(() => []);
  const failed = new Set<Provider>();
  const lucida = enabled.includes("Lucida")
    ? adapters.Lucida(query)
    : undefined;
  void lucida?.catch(() => {});
  const results = await Promise.allSettled(
    enabled.map(async (provider, i) => {
      try {
        if (provider === "SoundCloud" && lucida) {
          let timer: ReturnType<typeof setTimeout>;
          const primary = await Promise.race([
            lucida.catch(() => []),
            new Promise<Track[]>((resolve) => {
              timer = setTimeout(() => resolve([]), 8000);
            }),
          ]).finally(() => clearTimeout(timer));
          if (mergeSearch(primary, query).length) return [];
        }
        found[i] = await (provider === "Lucida" && lucida
          ? lucida
          : adapters[provider](query));
        return found[i];
      } catch (error) {
        failed.add(provider);
        throw error;
      } finally {
        onUpdate?.({
          tracks: mergeSearch(found.flat(), query),
          unavailable: [...failed],
        });
      }
    }),
  );
  return {
    tracks: mergeSearch(
      results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
      query,
    ),
    unavailable: enabled.filter((_, i) => results[i].status === "rejected"),
  };
}
