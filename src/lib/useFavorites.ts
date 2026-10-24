import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { readSetting, saveSetting, storeTracks, type Track } from "./library";
import type { Feedback } from "./recommendations";
import { cachedCatalogTracks, deezerTrack } from "./artists";
import { appleTrack } from "./appleCatalog";

export default function useFavorites(
  tracks: Track[],
  selected: Track | null,
  setTracks: Dispatch<SetStateAction<Track[]>>,
  ready: boolean,
  feedback: (track: Track, event: Feedback) => void,
  notify: (message: string) => void,
) {
  const [favorites, setFavorites] = useState<string[]>(() => [
    ...new Set(
      readSetting<string[]>("favorites", []).filter(
        (id) =>
          !["quiet-1", "focus-1", "night-1", "slow-1", "gold-1"].includes(id),
      ),
    ),
  ]);
  const [recovering, setRecovering] = useState(false);
  const [revision, setRevision] = useState(0);
  const saving = useRef(new Set<string>());
  const currentTracks = useRef(tracks);
  currentTracks.current = tracks;

  useEffect(() => saveSetting("favorites", favorites), [favorites]);
  useEffect(() => {
    const retry = () => setRevision((old) => old + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  const toggleFavorite = useCallback(
    async (id: string, candidate?: Track) => {
      if (saving.current.has(id)) return;
      const liked = favorites.includes(id);
      const track =
        tracks.find((track) => track.id === id) ||
        (selected?.id === id ? selected : undefined) ||
        (candidate?.id === id ? candidate : undefined);
      if (!liked && !track) {
        notify("Не удалось сохранить избранное: запись песни не загружена.");
        return;
      }
      saving.current.add(id);
      try {
        if (!liked && track) {
          const saved = { ...track, inLibrary: true };
          await storeTracks([{ track: saved }]);
          setTracks((old) => [...old.filter((item) => item.id !== id), saved]);
        }
        if (track) feedback(track, liked ? "unlike" : "like");
        setFavorites((old) =>
          liked
            ? old.filter((item) => item !== id)
            : [...new Set([...old, id])],
        );
      } catch {
        notify(
          "Не удалось сохранить избранное. Проверьте свободное место на диске.",
        );
      } finally {
        saving.current.delete(id);
      }
    },
    [favorites, tracks, selected, feedback, notify, setTracks],
  );

  useEffect(() => {
    if (!ready) return;
    const missing = favorites.filter(
      (id) => !currentTracks.current.some((track) => track.id === id),
    );
    if (!missing.length) {
      setRecovering(false);
      return;
    }
    let active = true;
    setRecovering(true);
    const recover = async () => {
      const cached = new Map(
        cachedCatalogTracks().map((track) => [track.id, track]),
      );
      for (let offset = 0; active && offset < missing.length; offset += 4) {
        await Promise.allSettled(
          missing.slice(offset, offset + 4).map(async (id) => {
            const track =
              cached.get(id) ||
              (id.startsWith("apple:")
                ? await appleTrack(id.slice(6))
                : id.startsWith("deezer:")
                  ? await deezerTrack(id.slice(7))
                  : undefined);
            if (!active || !track || track.id !== id) return;
            const saved = { ...track, inLibrary: true };
            await storeTracks([{ track: saved }]);
            if (active)
              setTracks((old) =>
                old.some((item) => item.id === id) ? old : [...old, saved],
              );
          }),
        );
      }
    };
    void recover()
      .catch(() => {})
      .finally(() => {
        if (active) setRecovering(false);
      });
    return () => {
      active = false;
    };
  }, [ready, favorites, revision, setTracks]);

  const missing = favorites.filter(
    (id) => !tracks.some((track) => track.id === id),
  ).length;
  const retry = useCallback(() => setRevision((old) => old + 1), []);
  return { favorites, toggleFavorite, recovering, missing, retry };
}
