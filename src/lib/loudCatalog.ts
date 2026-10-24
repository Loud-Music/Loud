import type { Artist, ArtistCatalog, ArtistRelease } from "./artists";
import type { Track } from "./library";
import { catalogJSON } from "./catalogRequest";

export const loudOrigin = "https://api.mambo.wtf";

function distributor(value: unknown): Artist["distributor"] {
  if (!value || typeof value !== "object") return;
  const item = value as { id?: unknown; name?: unknown };
  if (
    Number.isSafeInteger(item.id) &&
    (item.id as number) > 0 &&
    typeof item.name === "string"
  )
    return { id: item.id as number, name: item.name };
}

function media(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.origin === loudOrigin &&
      url.pathname.startsWith("/media/") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function artist(value: unknown): Artist | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  if (
    item.catalog !== "loud" ||
    !Number.isSafeInteger(item.id) ||
    (item.id as number) <= 0 ||
    typeof item.name !== "string" ||
    !item.name.trim()
  )
    return;
  return {
    id: item.id as number,
    name: item.name,
    catalog: "loud",
    distributor: distributor(item.distributor),
    picture_xl: media(item.picture_xl) ? item.picture_xl : undefined,
    banner: media(item.banner) ? item.banner : undefined,
    bio: typeof item.bio === "string" ? item.bio : undefined,
    description:
      typeof item.description === "string" ? item.description : undefined,
    genres: Array.isArray(item.genres)
      ? item.genres
          .filter((value): value is string => typeof value === "string")
          .slice(0, 8)
      : [],
    links: Array.isArray(item.links)
      ? item.links
          .flatMap((link) => {
            if (
              !link ||
              typeof link.label !== "string" ||
              typeof link.url !== "string"
            )
              return [];
            try {
              const url = new URL(link.url);
              return url.protocol === "https:" && !url.username && !url.password
                ? [{ label: link.label, url: url.href }]
                : [];
            } catch {
              return [];
            }
          })
          .slice(0, 8)
      : [],
  };
}

function track(value: unknown): Track | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Track;
  const locked =
    typeof item.availableAt === "string" &&
    Number.isFinite(Date.parse(item.availableAt));
  if (
    typeof item.id !== "string" ||
    !/^loud:[1-9]\d*$/.test(item.id) ||
    item.source !== "Loud" ||
    typeof item.title !== "string" ||
    typeof item.artist !== "string" ||
    typeof item.album !== "string" ||
    !Number.isFinite(item.duration) ||
    item.duration <= 0 ||
    (!media(item.src) && !locked) ||
    !media(item.cover) ||
    !["FLAC", "MP3", "AAC"].includes(item.format || "")
  )
    return;
  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    artists: Array.isArray(item.artists)
      ? item.artists.filter((name) => typeof name === "string")
      : [item.artist],
    album: item.album,
    duration: item.duration,
    cover: item.cover,
    src: item.src,
    source: "Loud",
    availableAt: locked ? item.availableAt : undefined,
    loudReleaseId: Number.isSafeInteger(item.loudReleaseId)
      ? item.loudReleaseId
      : undefined,
    lyricsUrl:
      typeof item.lyricsUrl === "string" &&
      /^https:\/\/api\.mambo\.wtf\/v1\/tracks\/[1-9]\d*\/lyrics$/.test(
        item.lyricsUrl,
      )
        ? item.lyricsUrl
        : undefined,
    format: item.format,
    qualityHint: item.format === "FLAC" ? "lossless" : "lossy",
    downloadAllowed: item.downloadAllowed !== false,
    trackNumber:
      Number.isSafeInteger(item.trackNumber) && item.trackNumber! > 0
        ? item.trackNumber
        : undefined,
    discNumber:
      Number.isSafeInteger(item.discNumber) && item.discNumber! > 0
        ? item.discNumber
        : undefined,
    sampleRate:
      Number.isFinite(item.sampleRate) && item.sampleRate! > 0
        ? item.sampleRate
        : undefined,
    bitDepth:
      Number.isFinite(item.bitDepth) && item.bitDepth! > 0
        ? item.bitDepth
        : undefined,
    remoteUrl: item.src,
    fullRecording: !locked,
    preview: undefined,
    loudArtistIds: Array.isArray(item.loudArtistIds)
      ? item.loudArtistIds.filter((id) => Number.isSafeInteger(id) && id > 0)
      : [],
  };
}

function release(value: unknown): ArtistRelease | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as ArtistRelease;
  if (
    typeof item.id !== "string" ||
    !/^loud:[1-9]\d*$/.test(item.id) ||
    typeof item.title !== "string" ||
    !Array.isArray(item.tracks)
  )
    return;
  return {
    id: item.id,
    title: item.title,
    publishAt: typeof item.publishAt === "string" ? item.publishAt : undefined,
    presave: item.presave === true,
    available: item.available !== false,
    cover_big: media(item.cover_big) ? item.cover_big : undefined,
    distributor: distributor(item.distributor),
    release_date:
      typeof item.release_date === "string" ? item.release_date : undefined,
    record_type: ["single", "album", "ep"].includes(item.record_type || "")
      ? item.record_type
      : undefined,
    tracks: item.tracks.flatMap((value) => track(value) || []),
  };
}

export async function loudRelease(id: string): Promise<ArtistRelease> {
  if (!/^loud:[1-9]\d*$/.test(id)) throw new Error("Некорректный ID релиза");
  const result = release(
    await catalogJSON<unknown>("loud", `/v1/releases/${id.slice(5)}`),
  );
  if (!result || result.id !== id)
    throw new Error("Не удалось загрузить релиз LOUD");
  return result;
}

export async function loudArtists(query = ""): Promise<Artist[]> {
  const response = await catalogJSON<{ data?: unknown[] }>(
    "loud",
    `/v1/artists?${new URLSearchParams({ query })}`,
  );
  if (!Array.isArray(response.data)) throw new Error("Каталог LOUD недоступен");
  return response.data.flatMap((value) => artist(value) || []);
}

export async function loudTracks(query: string): Promise<Track[]> {
  const response = await catalogJSON<{ data?: unknown[] }>(
    "loud",
    `/v1/tracks?${new URLSearchParams({ query })}`,
  );
  if (!Array.isArray(response.data)) throw new Error("Каталог LOUD недоступен");
  return response.data.flatMap((value) => track(value) || []);
}

export async function loudArtistProfile(id: number): Promise<ArtistCatalog> {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error("Некорректный ID артиста");
  const response = await catalogJSON<ArtistCatalog>(
    "loud",
    `/v1/artists/${id}`,
  );
  const identity = artist(response.artist);
  if (
    !identity ||
    identity.id !== id ||
    !Array.isArray(response.songs) ||
    !Array.isArray(response.releases)
  )
    throw new Error("Не удалось загрузить профиль LOUD");
  const songs = response.songs.flatMap((value) => track(value) || []);
  const releases = response.releases.flatMap((value) => release(value) || []);
  return {
    artist: identity,
    songs,
    releases,
    more: false,
    related: [],
    partial: false,
  };
}
