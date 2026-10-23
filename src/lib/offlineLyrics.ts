import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import { loadKaraoke, loadLyrics } from "./lyrics";
import { lyricIdentity } from "./lyricsCache";

export async function saveOfflineLyrics(
  track: Track,
): Promise<"words" | "lines" | "missing"> {
  const [words, lines] = await Promise.allSettled([
    loadKaraoke(track),
    loadLyrics(track),
  ]);
  let saved: "words" | "lines" | "missing" = "missing";
  for (const [kind, result] of [
    ["lines", lines],
    ["words", words],
  ] as const) {
    if (result.status !== "fulfilled" || !result.value) continue;
    await invoke("lyrics_cache_put", {
      key: lyricIdentity(kind, track),
      value: result.value,
      pinned: true,
    });
    saved = kind;
  }
  if (
    saved === "missing" &&
    (words.status === "rejected" || lines.status === "rejected")
  )
    throw new Error(
      "Не удалось сохранить текст. Загрузим его при восстановлении соединения.",
    );
  return saved;
}
