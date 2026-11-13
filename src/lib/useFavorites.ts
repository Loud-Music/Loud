import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { readSetting, saveSetting, storeTracks, type Track } from "./library";
import type { Feedback } from "./recommendations";
import { cachedCatalogTracks, deezerTrack } from "./artists";
import { appleTrack } from "./appleCatalog";
import { flushPersistence } from "./persistence";

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
  const favoriteState = useRef(favorites);
  const currentTracks = useRef(tracks);
  currentTracks.current = tracks;

  useEffect(() => saveSetting("favorites", favoriteState.current), []);
  const updateFavorites = useCallback(
    async (update: (ids: string[]) => string[]) => {
      const next = update(favoriteState.current);
      saveSetting("favorites", next);
      favoriteState.current = next;
      setFavorites(next);
      await flushPersistence();
    },
    [],
  );
  useEffect(() => {
    const retry = () => setRevision((old) => old + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  const toggleFavorite = useCallback(
    async (id: string, candidate?: Track) => {
      if (saving.current.has(id)) return;
      const liked = favoriteState.current.includes(id);
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
        await updateFavorites((old) =>
          liked
            ? old.filter((item) => item !== id)
            : [...new Set([...old, id])],
        );
        if (track) feedback(track, liked ? "unlike" : "like");
      } catch {
        notify(
          "Не удалось сохранить избранное. Проверьте свободное место на диске.",
        );
      } finally {
        saving.current.delete(id);
      }
    },
    [tracks, selected, feedback, notify, setTracks, updateFavorites],
  );
  const setFavoriteMany = useCallback(
    async (items: Track[], liked: boolean) => {
      const unique = [
        ...new Map(items.map((track) => [track.id, track])).values(),
      ];
      if (unique.some((track) => saving.current.has(track.id)))
        throw new Error("Дождитесь сохранения избранного.");
      for (const track of unique) saving.current.add(track.id);
      try {
        if (liked) {
          const saved = unique.map((track) => ({ ...track, inLibrary: true }));
          await storeTracks(saved.map((track) => ({ track })));
          setTracks((old) => [
            ...new Map(
              [...old, ...saved].map((track) => [track.id, track]),
            ).values(),
          ]);
        }
        const ids = new Set(unique.map((track) => track.id));
        const changed = unique.filter(
          (track) => favoriteState.current.includes(track.id) !== liked,
        );
        await updateFavorites((old) =>
          liked
            ? [...new Set([...old, ...ids])]
            : old.filter((id) => !ids.has(id)),
        );
        for (const track of changed) feedback(track, liked ? "like" : "unlike");
      } finally {
        for (const track of unique) saving.current.delete(track.id);
      }
    },
    [setTracks, feedback, updateFavorites],
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
  return {
    favorites,
    toggleFavorite,
    setFavoriteMany,
    recovering,
    missing,
    retry,
  };
}
