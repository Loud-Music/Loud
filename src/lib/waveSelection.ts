import type { Track } from "./library";
import { recordingKey } from "./library";
import { rankAlbums, type TasteProfile } from "./recommendations";

export function selectWaveTracks(
  candidates: Map<string, Track>,
  library: Track[],
  taste: TasteProfile,
  seed: number,
) {
  const known = new Set([
    ...library.map(recordingKey),
    ...taste.history.flatMap((event) =>
      event.recording ? [event.recording] : [],
    ),
  ]);
  const rankTracks = (tracks: Track[], limit: number) =>
    rankAlbums(
      tracks.map((t) => ({
        id: t.id,
        title: t.album,
        artist: t.artist,
        cover: t.cover,
        license: t.license || "",
        tags: [...(t.tags || []), t.genre || ""],
      })),
      taste,
      seed,
      limit,
    ).map((item) => ({
      ...candidates.get(item.album.id)!,
      recommendationReason: item.reason,
    }));
  const freshPool: Track[] = [];
  const familiarPool: Track[] = [];
  for (const track of candidates.values()) {
    const pool = known.has(recordingKey(track)) ? familiarPool : freshPool;
    pool.push(track);
  }
  const fresh = rankTracks(freshPool, 8);
  const familiar = rankTracks(familiarPool, 8);
  const freshTarget =
    taste.mix === "discovery" ? 8 : taste.mix === "familiar" ? 2 : 6;
  const selectedFresh = fresh.slice(0, freshTarget);
  const selectedFamiliar = familiar.slice(0, 8 - selectedFresh.length);
  selectedFresh.push(
    ...fresh.slice(selectedFresh.length, 8 - selectedFamiliar.length),
  );
  const ordered: Track[] = [];
  while (selectedFresh.length || selectedFamiliar.length) {
    ordered.push(...selectedFresh.splice(0, taste.mix === "familiar" ? 1 : 3));
    ordered.push(...selectedFamiliar.splice(0, 1));
  }
  return { tracks: ordered, known };
}
