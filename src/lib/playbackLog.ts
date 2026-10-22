import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
export function playbackLog(
  stage: string,
  track: Pick<Track, "id" | "title" | "artist" | "duration">,
  details: Record<string, unknown> = {},
) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const error =
    details.error === undefined
      ? undefined
      : String(details.error)
          .replace(/https?:\/\/[^\s"<>]+/g, "[url]")
          .slice(0, 1600);
  void invoke("playback_log", {
    event: {
      at: new Date().toISOString(),
      stage,
      track: {
        id: track.id,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
      },
      ...details,
      error,
    },
  }).catch(() => {});
}
