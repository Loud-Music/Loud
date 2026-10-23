import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";

interface SoundCloudItem {
  id: string;
  title: string;
  artist?: string;
  uploader?: string;
  album?: string;
  duration?: number;
  webpage_url?: string;
  thumbnail?: string;
  availability?: string;
}

export async function importSoundCloud(url: string) {
  if (!("__TAURI_INTERNALS__" in window))
    throw new Error("Импорт SoundCloud доступен в приложении LOUD.");
  const result = await invoke<{
    id?: string;
    title?: string;
    total: number;
    entries: SoundCloudItem[];
  }>("soundcloud_import", { url });
  const tracks = new Map<string, Track>();
  for (const item of result.entries) {
    if (
      !item.id ||
      !item.title ||
      !item.duration ||
      !Number.isFinite(item.duration) ||
      !item.webpage_url ||
      !/^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+\/?$/.test(
        item.webpage_url,
      ) ||
      ["premium_only", "subscriber_only", "private", "needs_auth"].includes(
        item.availability || "",
      )
    )
      continue;
    const track: Track = {
      id: `soundcloud:${item.id}`,
      title: item.title,
      artist: item.artist || item.uploader || "Неизвестный исполнитель",
      album: item.album || result.title || item.title,
      duration: item.duration,
      cover: item.thumbnail || "/covers/imported.svg",
      source: "SoundCloud",
      format: "Аудио",
      extractorUrl: item.webpage_url,
      attributionUrl: item.webpage_url,
      inLibrary: true,
    };
    tracks.set(track.id, track);
  }
  if (!tracks.size)
    throw new Error("В этой ссылке нет доступных публичных песен.");
  return {
    id: result.id ? `soundcloud:${result.id}` : undefined,
    name: result.title || "SoundCloud",
    tracks: [...tracks.values()],
    skipped: Math.max(0, result.total - tracks.size),
  };
}
