import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { prepareOfflineSource } from "./extractor";
import { errorMessage } from "./errors";
import { persistentSet, flushPersistence } from "./persistence";
import {
  localTrack,
  loadOffline,
  offlineKey,
  type OfflineGroup,
  type OfflineJob,
  type OfflineState,
} from "./offlineStore";
import { saveOfflineLyrics } from "./offlineLyrics";
import { forgetMissingLyrics } from "./lyricsCache";
import type { Track } from "./library";

export interface OfflineProgress {
  bytes: number;
  total?: number;
}
export default function useOffline(
  account: string,
  ready: boolean,
  playbackBusy: boolean,
  onSaved: (track: Track) => void,
) {
  const [state, setState] = useState(() => loadOffline(account));
  const data = useRef(state);
  const mounted = useRef(true);
  const saving = useRef(onSaved);
  saving.current = onSaved;
  const suspended = useRef(playbackBusy);
  suspended.current = playbackBusy;
  const audio = useRef(new Set<string>());
  const lyrics = useRef(new Set<string>());
  const [tick, setTick] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [progress, setProgress] = useState<Record<string, OfflineProgress>>({});
  const update = useCallback(
    (change: (state: OfflineState) => OfflineState) => {
      if (!mounted.current) return;
      const next = change(data.current);
      data.current = next;
      setState(next);
      persistentSet(offlineKey(account), JSON.stringify(next));
    },
    [account],
  );
  const job = useCallback(
    (id: string, change: Partial<OfflineJob>) =>
      update((old) => ({
        ...old,
        jobs: { ...old.jobs, [id]: { ...old.jobs[id], ...change } },
      })),
    [update],
  );
  useEffect(() => {
    mounted.current = true;
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    let stop: (() => void) | undefined;
    if ("__TAURI_INTERNALS__" in window)
      void listen<{ account: string; id: string } & OfflineProgress>(
        "offline-progress",
        ({ payload }) => {
          if (payload.account === account && mounted.current)
            setProgress((old) => ({ ...old, [payload.id]: payload }));
        },
      ).then((unlisten) => {
        if (mounted.current) stop = unlisten;
        else unlisten();
      });
    return () => {
      mounted.current = false;
      stop?.();
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      for (const id of audio.current)
        void invoke("offline_pause", { account, id }).catch(() => {});
    };
  }, [account]);
  useEffect(() => {
    if (playbackBusy)
      for (const id of audio.current)
        void invoke("offline_pause", { account, id }).catch(() => {});
  }, [playbackBusy, account]);
  useEffect(() => {
    if (!ready || !online || playbackBusy || !("__TAURI_INTERNALS__" in window))
      return;
    const now = Date.now();
    const items = Object.values(state.jobs);
    const next = items.find(
      (item) =>
        ["queued", "retry"].includes(item.state) &&
        (item.retryAt || 0) <= now &&
        !audio.current.has(item.track.id),
    );
    if (audio.current.size < 1 && next) {
      const id = next.track.id;
      audio.current.add(id);
      void (async () => {
        try {
          job(id, { state: "loading", error: undefined });
          await flushPersistence();
          const source =
            next.source ||
            (await prepareOfflineSource(next.track, next.skipCache));
          if (!mounted.current) return;
          job(id, { source });
          await flushPersistence();
          if (data.current.jobs[id]?.state === "paused") return;
          if (suspended.current) {
            job(id, { state: "queued" });
            return;
          }
          const saved = localTrack(
            await invoke<Track>("offline_download", {
              account,
              track: next.track,
              source,
            }),
          );
          if (!mounted.current) return;
          job(id, {
            track: saved,
            state: "done",
            attempts: 0,
            retryAt: undefined,
            error: undefined,
            source: undefined,
            lyrics: "pending",
          });
          saving.current(saved);
        } catch (cause) {
          if (!mounted.current || data.current.jobs[id]?.state === "paused")
            return;
          if (suspended.current || /приостановлена/.test(String(cause))) {
            job(id, { state: "queued", retryAt: Date.now() + 1500 });
          } else {
            const attempts = next.attempts + 1;
            const expired =
              !!data.current.jobs[id]?.source?.path ||
              /HTTP (?:403|404|410)|сохранённый аудиофайл/.test(String(cause));
            job(id, {
              state:
                /No space left|os error (?:112|28)|disk.*full|превышает ограничение|не поддерживает офлайн|Автор отключил|Неподдерживаемый аудиоформат/i.test(
                  String(cause),
                )
                  ? "paused"
                  : "retry",
              attempts,
              retryAt:
                Date.now() +
                Math.min(300000, 5000 * 2 ** Math.min(attempts - 1, 6)),
              source: expired ? undefined : data.current.jobs[id]?.source,
              skipCache:
                next.skipCache || !!data.current.jobs[id]?.source?.path,
              error: errorMessage(
                cause,
                "Загрузка прервана. Повторим автоматически.",
              ),
            });
          }
        } finally {
          audio.current.delete(id);
          if (mounted.current) setTick((value) => value + 1);
        }
      })();
    }
    for (const item of items) {
      if (lyrics.current.size >= 2) break;
      if (
        item.state !== "done" ||
        !["pending", "retry"].includes(item.lyrics) ||
        (item.lyricRetryAt || 0) > now ||
        lyrics.current.has(item.track.id)
      )
        continue;
      const id = item.track.id;
      lyrics.current.add(id);
      void (async () => {
        try {
          const [text, cover] = await Promise.allSettled([
            saveOfflineLyrics(item.track),
            item.track.offlineCoverPath || !item.track.offlinePath
              ? Promise.resolve(item.track)
              : invoke<Track>("offline_cover", {
                  account,
                  track: item.track,
                }).then(localTrack),
          ]);
          if (!mounted.current) return;
          if (cover.status === "fulfilled" && cover.value.offlineCoverPath) {
            job(id, { track: cover.value });
            saving.current(cover.value);
          }
          if (text.status === "rejected") throw text.reason;
          job(id, { lyrics: text.value, lyricRetryAt: undefined });
        } catch {
          job(id, { lyrics: "retry", lyricRetryAt: Date.now() + 60000 });
        } finally {
          lyrics.current.delete(id);
          if (mounted.current) setTick((value) => value + 1);
        }
      })();
    }
    const future = items.flatMap((item) => [
      ...(["queued", "retry"].includes(item.state) &&
      item.retryAt &&
      item.retryAt > now
        ? [item.retryAt]
        : []),
      ...(item.state === "done" &&
      item.lyrics === "retry" &&
      item.lyricRetryAt &&
      item.lyricRetryAt > now
        ? [item.lyricRetryAt]
        : []),
    ]);
    if (!future.length) return;
    const timer = window.setTimeout(
      () => setTick((value) => value + 1),
      Math.max(100, Math.min(...future) - now),
    );
    return () => window.clearTimeout(timer);
  }, [state, ready, online, playbackBusy, account, tick, job]);
  const enqueue = useCallback(
    async (group: OfflineGroup, tracks: Track[]) => {
      if (!("__TAURI_INTERNALS__" in window))
        throw new Error("Офлайн-загрузка доступна в приложении LOUD.");
      update((old) => {
        const jobs = { ...old.jobs };
        for (const track of tracks) {
          const previous = jobs[track.id];
          if (previous?.state === "done") continue;
          const local =
            track.source === "Local" && !!track.src && !track.extractorUrl;
          jobs[track.id] = {
            ...previous,
            track: previous?.track || track,
            state: local ? "done" : "queued",
            attempts: 0,
            retryAt: undefined,
            error: undefined,
            lyrics: previous?.lyrics || "pending",
          };
        }
        return {
          groups: [
            ...old.groups.filter((item) => item.id !== group.id),
            { ...group, tracks: [...new Set(tracks.map((track) => track.id))] },
          ],
          jobs,
        };
      });
      await flushPersistence();
    },
    [update],
  );
  const control = useCallback(
    (ids: string[], action: "pause" | "resume") => {
      update((old) => {
        const jobs = { ...old.jobs };
        for (const id of ids) {
          const item = jobs[id];
          if (!item) continue;
          if (action === "pause" && item.state !== "done") {
            jobs[id] = { ...item, state: "paused" };
            if (audio.current.has(id))
              void invoke("offline_pause", { account, id }).catch(() => {});
          } else if (action === "resume") {
            if (item.state === "done" && item.lyrics !== "words")
              forgetMissingLyrics(item.track);
            jobs[id] = {
              ...item,
              state: item.state === "done" ? "done" : "queued",
              error: undefined,
              attempts: 0,
              retryAt: undefined,
              lyrics: item.lyrics !== "words" ? "pending" : item.lyrics,
              lyricRetryAt: undefined,
            };
          }
        }
        return { ...old, jobs };
      });
    },
    [update, account],
  );
  return {
    ...state,
    progress,
    online,
    enqueue,
    control,
    pending: Object.values(state.jobs).filter((job) => job.state !== "done")
      .length,
  };
}
