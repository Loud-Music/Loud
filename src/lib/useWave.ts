import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { albumTracks, searchCatalog } from "./catalog";
import type { CatalogAlbum } from "./catalog";
import { readSetting, saveSetting, recordingKey } from "./library";
import type { Track } from "./library";
import {
  emptyTaste,
  waveArtists,
  freshWaveTracks,
  rankAlbums,
  seededNoise,
  tasteGenres,
  updateTaste,
  recentWaveHistory,
} from "./recommendations";
import type { Feedback, TasteProfile } from "./recommendations";
import { waveArtistTracks } from "./artists";
import { selectWaveTracks } from "./waveSelection";
import { mergeSearch, searchAudius, searchCommons } from "./search";
import { searchMixter, searchJamendo } from "./additionalCatalogs";
import { searchExtracted, searchLucida } from "./extractor";
async function bounded<T>(
  task: Promise<T>,
  fallback: T,
  ms = 6500,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      task,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
const searches = new Map<string, { at: number; albums: CatalogAlbum[] }>();
function suitableTrack(track: Track) {
  return (
    track.source !== "Loud" &&
    Boolean(track.src || track.extractorUrl) &&
    !track.preview &&
    track.duration >= 40 &&
    track.duration <= 900 &&
    !/\b(intro|outro|silence|test|metronome|métronome|exercise|accompaniment|accompagnement|tutorial|dj set|dj mix|mixtape)\b/i.test(
      track.title,
    )
  );
}
async function candidates(query: string) {
  const old = searches.get(query);
  if (old?.albums.length && Date.now() - old.at < 600000) return old.albums;
  let { albums } = await searchCatalog(query, 1, "FLAC");
  if (!albums.length) ({ albums } = await searchCatalog(query));
  searches.set(query, { at: Date.now(), albums });
  return albums;
}
export default function useWave(library: Track[]) {
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const [profile, setProfile] = useState<TasteProfile>(() =>
    readSetting("taste:v1", emptyTaste()),
  );
  const [recommendations, setRecommendations] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const seed = useRef(Date.now() >>> 0);
  const latestProfile = useRef(profile);
  latestProfile.current = profile;
  const changeProfile = useCallback((patch: Partial<TasteProfile>) => {
    setRecommendations([]);
    setError("");
    setProfile((old) => {
      const next = { ...old, ...patch };
      saveSetting("taste:v1", next);
      return next;
    });
  }, []);
  const feedback = useCallback((track: Track, event: Feedback) => {
    if (track.source === "Loud") return;
    setError("");
    setProfile((old) => {
      const next = updateTaste(old, track, event);
      saveSetting("taste:v1", next);
      return next;
    });
  }, []);
  const load = useCallback(async (exclude: string[] = []) => {
    if (busy.current) return [];
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const taste = latestProfile.current;
      seed.current = (seed.current + 1) >>> 0;
      const weighted = [
        ...new Set([
          ...taste.genres,
          ...Object.entries(taste.genreWeights)
            .filter(
              ([tag, w]) =>
                w > 3 && tasteGenres.some((g) => g.toLowerCase() === tag),
            )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([tag]) => tag),
        ]),
      ];
      const artists = waveArtists(taste, seed.current);
      const artist = artists[0];
      if (!weighted.length && !artist) {
        setRecommendations([]);
        setError(
          "Выберите любимые жанры или послушайте и отметьте музыку в поиске — так волна узнает ваш вкус.",
        );
        return [];
      }
      const chosen = weighted.length ? weighted : [artist!];
      const offset = seed.current % chosen.length;
      const genres = [chosen[offset], chosen[(offset + 1) % chosen.length]];
      const exploration = tasteGenres.filter(
        (g) => !chosen.some((c) => c.toLowerCase() === g.toLowerCase()),
      );
      const explore = exploration.length
        ? exploration[seed.current % exploration.length]
        : "experimental";
      const queries = [
        ...new Set([
          ...genres,
          ...artists,
          ...(taste.mix === "familiar" || artists.length ? [] : [explore]),
        ]),
      ];
      const [results, direct] = await Promise.all([
        Promise.allSettled(
          (artists.length ? [] : queries).map((query) =>
            bounded(candidates(query), []),
          ),
        ),
        Promise.allSettled([
          ...artists.map((name) =>
            bounded(
              waveArtistTracks(name, taste.mix !== "familiar", seed.current),
              [],
            ),
          ),
          ...(artists.length
            ? []
            : [
                bounded(searchAudius(genres[0]), []),
                bounded(searchCommons(genres[1]), []),
                bounded(searchMixter(genres[0]), []),
                bounded(searchJamendo(genres[1]), []),
              ]),
          bounded(
            searchLucida(artist || genres[0]).then(
              (tracks) =>
                tracks.length ? tracks : searchExtracted(artist || genres[0]),
              () => searchExtracted(artist || genres[0]),
            ),
            [],
          ),
        ]),
      ]);
      const pool = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      const directTracks = [
        ...libraryRef.current,
        ...direct.flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        ),
      ];
      if (!pool.length && !directTracks.length)
        throw new Error(
          "Не удалось загрузить релизы. Проверьте интернет и попробуйте ещё раз.",
        );
      const ranked = rankAlbums(pool, taste, seed.current, 12);
      if (
        taste.mix !== latestProfile.current.mix ||
        taste.energy !== latestProfile.current.energy ||
        taste.genres !== latestProfile.current.genres
      )
        return [];
      const recent = new Set([
        ...exclude,
        ...recentWaveHistory(taste).map((h) => h.id),
      ]);
      const output: Track[] = [];
      for (
        let offset = 0;
        offset < ranked.length && output.length < 6;
        offset += 4
      ) {
        const batch = ranked.slice(offset, offset + 4);
        const resolved = await Promise.allSettled(
          batch.map(async (item) => {
            const tracks = await bounded(albumTracks(item.album), []);
            const usable = tracks.filter(
              (t) => !recent.has(t.id) && suitableTrack(t),
            );
            if (!usable.length) return undefined;
            const track =
              usable[
                Math.floor(
                  seededNoise(item.album.id, seed.current) * usable.length,
                )
              ];
            return { ...track, recommendationReason: item.reason };
          }),
        );
        output.push(
          ...resolved.flatMap((result) =>
            result.status === "fulfilled" && result.value ? [result.value] : [],
          ),
        );
      }
      const freshDirect = directTracks.filter(
        (t) => !recent.has(t.id) && suitableTrack(t),
      );
      const combined = new Map(
        freshWaveTracks(
          mergeSearch([...output, ...freshDirect], ""),
          taste,
          exclude,
        ).map((t) => [t.id, t]),
      );
      if (!combined.size) {
        const retryTaste = {
          ...taste,
          history: taste.history
            .filter((h) => h.event === "listen" || h.event === "skip")
            .slice(0, 2),
        };
        for (const track of freshWaveTracks(
          mergeSearch([...output, ...directTracks.filter(suitableTrack)], ""),
          retryTaste,
          exclude,
        ))
          combined.set(track.id, track);
      }
      const { tracks: ordered, known } = selectWaveTracks(
        combined,
        libraryRef.current,
        taste,
        seed.current,
      );
      if (!ordered.length)
        throw new Error(
          "В этом наборе пока нет новых треков. Измените жанры или попробуйте «Открытия».",
        );
      if (
        taste.genres !== latestProfile.current.genres ||
        taste.mix !== latestProfile.current.mix ||
        taste.energy !== latestProfile.current.energy
      )
        return [];
      setRecommendations(ordered);
      if ("__TAURI_INTERNALS__" in window)
        void invoke("playback_log", {
          event: {
            at: new Date().toISOString(),
            stage: "wave-ready",
            mix: taste.mix,
            seeds: artists,
            candidates: combined.size,
            fresh: ordered.filter((track) => !known.has(recordingKey(track)))
              .length,
            tracks: ordered.map((track) => ({
              id: track.id,
              title: track.title,
              artist: track.artist,
              duration: track.duration,
              fresh: !known.has(recordingKey(track)),
            })),
          },
        }).catch(() => {});
      return ordered;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);
  return {
    profile,
    changeProfile,
    feedback,
    recommendations,
    loading,
    error,
    load,
  };
}
