import { catalogJSON } from "./catalogRequest";
import { artistKey, releaseTracks, type ArtistRelease } from "./artists";
import type { Track } from "./library";
import { offlineAlbum } from "./offlineStore";
import { loudRelease } from "./loudCatalog";

export interface AlbumSeed extends ArtistRelease {
  artistName: string;
}
interface AlbumMetadata extends ArtistRelease {
  artist?: { name: string };
  label?: string;
  nb_tracks?: number;
  error?: unknown;
}
export function albumRoute(seed: AlbumSeed) {
  return `album:${JSON.stringify({ ...seed, tracks: undefined })}` as const;
}
export function parseAlbumRoute(value: string): AlbumSeed {
  try {
    const seed = JSON.parse(value);
    if (typeof seed.title === "string" && typeof seed.artistName === "string")
      return seed;
  } catch {}
  return { id: `local:${value}`, title: value, artistName: "" };
}
export async function loadAlbum(seed: AlbumSeed, saved: Track[]) {
  const offline = offlineAlbum(seed, saved);
  if (offline) return offline;
  if (String(seed.id).startsWith("loud:")) {
    const release = await loudRelease(String(seed.id));
    return {
      ...seed,
      ...release,
      artistNames: [
        ...new Set(
          (release.tracks || []).flatMap(
            (track) => track.artists || [track.artist],
          ),
        ),
      ],
      tracks: release.tracks || [],
      local: false,
    };
  }
  if (String(seed.id).startsWith("apple:")) {
    const tracks = await releaseTracks(seed);
    if (!tracks.length)
      throw new Error("Не удалось загрузить треклист альбома");
    return {
      ...seed,
      artistNames: [
        ...new Set(tracks.flatMap((track) => track.artists || [track.artist])),
      ],
      tracks,
      local: false,
    };
  }
  let id = String(seed.id);
  if (!/^\d+$/.test(id)) {
    const response = await catalogJSON<{
      data?: (AlbumMetadata & { id: number })[];
    }>(
      "deezer",
      `/search/album?${new URLSearchParams({ q: `${seed.title} ${seed.artistName}`, limit: "25" })}`,
    ).catch(() => ({ data: [] }));
    const match = response.data?.find(
      (item) =>
        artistKey(item.title) === artistKey(seed.title) &&
        !!seed.artistName &&
        artistKey(item.artist?.name || "") === artistKey(seed.artistName),
    );
    if (!match) {
      const tracks = saved.filter(
        (track) =>
          track.album === seed.title &&
          (!seed.artistName ||
            artistKey(track.artist) === artistKey(seed.artistName)),
      );
      if (!tracks.length)
        throw new Error(
          "Альбом не найден. Попробуйте открыть его со страницы артиста.",
        );
      return { ...seed, artistNames: [seed.artistName], tracks, local: true };
    }
    id = String(match.id);
  }
  const metadata = await catalogJSON<AlbumMetadata>("deezer", `/album/${id}`);
  if (metadata.error || !metadata.title)
    throw new Error("Не удалось загрузить альбом");
  const tracks = await releaseTracks({ ...metadata, id });
  if (metadata.nb_tracks && tracks.length < metadata.nb_tracks)
    throw new Error("Каталог вернул неполный треклист. Попробуйте ещё раз.");
  return {
    ...seed,
    ...metadata,
    id,
    artistName: metadata.artist?.name || seed.artistName,
    artistNames: [
      ...new Set([
        metadata.artist?.name || seed.artistName,
        ...(metadata.contributors || [])
          .filter(
            (artist) =>
              !artist.role ||
              artist.role === "Main" ||
              artist.role === "Featured",
          )
          .map((artist) => artist.name),
      ]),
    ].filter(Boolean),
    tracks,
    local: false,
  };
}
