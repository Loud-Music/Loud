import { useEffect } from "react";
import type { Track } from "./library";
import { loadKaraoke, loadLyrics } from "./lyrics";

const waiting = new Map<string, Track>();
const urgent = new Set<string>();
const attempted = new Map<string, number>();
let active = 0;
const keyFor = (track: Track) =>
  JSON.stringify([track.artist, track.title, Math.round(track.duration)]);
function drain() {
  while (waiting.size) {
    const [key, track] = waiting.entries().next().value!;
    if (active >= (urgent.has(key) ? 3 : 2)) break;
    waiting.delete(key);
    urgent.delete(key);
    active++;
    void Promise.allSettled([loadKaraoke(track), loadLyrics(track)]).finally(
      () => {
        active--;
        drain();
      },
    );
  }
}
export function prepareLyrics(track: Track, priority = false) {
  if (!track.id || track.preview) return;
  const key = keyFor(track);
  if (!waiting.has(key) && Date.now() - (attempted.get(key) || 0) < 60000)
    return;
  attempted.delete(key);
  attempted.set(key, Date.now());
  if (attempted.size > 256) attempted.delete(attempted.keys().next().value!);
  if (priority) {
    urgent.add(key);
    const rest = [...waiting];
    waiting.clear();
    for (const [id, item] of rest)
      if (id !== key && urgent.has(id)) waiting.set(id, item);
    waiting.set(key, track);
    for (const [id, item] of rest)
      if (id !== key && !urgent.has(id)) waiting.set(id, item);
  } else waiting.set(key, track);
  while (waiting.size > 12) {
    const last = [...waiting.keys()].at(-1)!;
    waiting.delete(last);
    urgent.delete(last);
    attempted.delete(last);
  }
  drain();
}
export function useLyricsPrefetch(tracks: Track[]) {
  const signature = JSON.stringify(
    tracks.map((track) => [track.id, keyFor(track)]),
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const track of tracks.slice(0, 4)) prepareLyrics(track);
    }, 200);
    const byId = new Map(tracks.map((track) => [track.id, track]));
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const track = byId.get(
                  (entry.target as HTMLElement).dataset.lyricsTrack || "",
                );
                if (track) prepareLyrics(track);
              }
            },
            { rootMargin: "0px" },
          )
        : undefined;
    document
      .querySelectorAll<HTMLElement>("[data-lyrics-track]")
      .forEach((element) => {
        if (byId.has(element.dataset.lyricsTrack || ""))
          observer?.observe(element);
      });
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [signature]);
}
