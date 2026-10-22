import { catalogJSON } from "./catalogRequest";
import type { Track } from "./library";
import { trackArtists } from "./library";
import { invoke } from "@tauri-apps/api/core";

const images = new Map<number, Promise<string | null>>();
export function appleArtistImage(id: number) {
  if (!("__TAURI_INTERNALS__" in window)) return Promise.resolve(null);
  let request = images.get(id);
  if (!request) {
    request = invoke<string | null>("apple_artist_image", { id }).catch(
      (error) => {
        images.delete(id);
        throw error;
      },
    );
    if (images.size >= 64) images.delete(images.keys().next().value!);
    images.set(id, request);
  }
  return request;
}

interface Recording {
  wrapperType: string;
  artistId: number;
  artistName: string;
  trackId?: number;
  trackName?: string;
  trackTimeMillis?: number;
  trackViewUrl?: string;
  collectionId?: number;
  collectionName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  discNumber?: number;
  trackNumber?: number;
  trackCount?: number;
}

export async function appleSearch(name: string) {
  const response = await catalogJSON<{ results: Recording[] }>(
    "itunes",
    `/search?${new URLSearchParams({ term: name, entity: "song", limit: "200", country: "us" })}`,
  );
  if (!Array.isArray(response.results))
    throw new Error("Каталог сейчас недоступен");
  return response.results;
}

export function appleTracks(items: Recording[]): Track[] {
  return items
    .filter(
      (item) =>
        item.trackId &&
        item.trackName &&
        item.trackTimeMillis &&
        item.trackViewUrl,
    )
    .map((item) => ({
      id: `apple:${item.trackId}`,
      appleId: String(item.trackId),
      title: item.trackName!,
      artist: item.artistName,
      artists: trackArtists({
        artist: item.artistName.replace(/\s+&\s+/g, ", "),
      }),
      album: item.collectionName || item.trackName!,
      duration: item.trackTimeMillis! / 1000,
      cover:
        item.artworkUrl100?.replace(/100x100bb/, "600x600bb") ||
        "/covers/imported.svg",
      genre: item.primaryGenreName,
      discNumber: item.discNumber,
      trackNumber: item.trackNumber,
      source: "Lucida",
      format: "Аудио",
      qualityHint: "lossless",
      extractorUrl: item.trackViewUrl,
      src: item.trackViewUrl,
    }));
}

export async function appleArtistCatalog(name: string) {
  const key = (value: string) => value.normalize("NFKC").toLowerCase().trim();
  const search = await appleSearch(name);
  const match =
    search.find((item) => key(item.artistName) === key(name)) ||
    search.find((item) =>
      trackArtists({ artist: item.artistName.replace(/\s+&\s+/g, ", ") }).some(
        (artist) => key(artist) === key(name),
      ),
    );
  if (!match) return;
  const lookup = async (entity: string) => {
    const response = await catalogJSON<{ results: Recording[] }>(
      "itunes",
      `/lookup?${new URLSearchParams({ id: String(match.artistId), entity, limit: "200", country: "us" })}`,
    );
    if (!Array.isArray(response.results))
      throw new Error("Каталог сейчас недоступен");
    return response.results;
  };
  const results = await Promise.allSettled([lookup("song"), lookup("album")]);
  const songs =
    results[0].status === "fulfilled"
      ? results[0].value.filter((item) => item.trackId)
      : search;
  const albums =
    results[1].status === "fulfilled"
      ? results[1].value.filter((item) => item.wrapperType === "collection")
      : songs;
  return {
    id: match.artistId,
    songs: appleTracks(songs),
    albums,
    partial: results.some((result) => result.status === "rejected"),
  };
}

export async function appleAlbum(id: string) {
  const response = await catalogJSON<{ results: Recording[] }>(
    "itunes",
    `/lookup?${new URLSearchParams({ id, entity: "song", limit: "200", country: "us" })}`,
  );
  if (!Array.isArray(response.results))
    throw new Error("Не удалось загрузить альбом");
  return appleTracks(response.results);
}
