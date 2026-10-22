import { catalogJSON } from "./catalogRequest";
import type { Track } from "./library";

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

export async function appleAlbum(id: string) {
  const response = await catalogJSON<{ results: Recording[] }>(
    "itunes",
    `/lookup?${new URLSearchParams({ id, entity: "song", limit: "200", country: "us" })}`,
  );
  if (!Array.isArray(response.results))
    throw new Error("Не удалось загрузить альбом");
  return appleTracks(response.results);
}
