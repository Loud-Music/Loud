import { convertFileSrc } from "@tauri-apps/api/core";
import { persistentGet } from "./persistence";
import { readSetting, type Track } from "./library";
import type { AlbumSeed } from "./albums";
import type { OfflineSource } from "./extractor";

export interface OfflineJob {
  track: Track;
  state: "queued" | "loading" | "paused" | "retry" | "done";
  source?: OfflineSource;
  skipCache?: boolean;
  error?: string;
  attempts: number;
  retryAt?: number;
  lyrics: "pending" | "words" | "lines" | "missing" | "retry";
  lyricRetryAt?: number;
}
export interface OfflineGroup {
  id: string;
  name: string;
  kind: "album" | "playlist" | "tracks";
  tracks: string[];
  album?: AlbumSeed;
}
export interface OfflineState {
  groups: OfflineGroup[];
  jobs: Record<string, OfflineJob>;
}
export const offlineKey = (account: string) =>
  account === "legacy"
    ? "loud:offline:v1"
    : `loud:account:${account}:offline:v1`;
export function loadOffline(account: string): OfflineState {
  try {
    const data = JSON.parse(
      persistentGet(offlineKey(account)) || "null",
    ) as OfflineState | null;
    if (
      data &&
      Array.isArray(data.groups) &&
      data.jobs &&
      typeof data.jobs === "object"
    )
      return {
        ...data,
        jobs: Object.fromEntries(
          Object.entries(data.jobs)
            .filter(([, job]) => job.track?.id)
            .map(([id, job]) => [
              id,
              {
                ...job,
                track: localTrack(job.track),
                state: job.state === "loading" ? "queued" : job.state,
              },
            ]),
        ),
      };
  } catch {}
  return { groups: [], jobs: {} };
}
export function localTrack(track: Track): Track {
  return {
    ...track,
    ...(track.offlinePath ? { src: convertFileSrc(track.offlinePath) } : {}),
    ...(track.offlineCoverPath
      ? { cover: convertFileSrc(track.offlineCoverPath) }
      : {}),
  };
}
export function offlineAlbum(seed: AlbumSeed, saved: Track[]) {
  const data = readSetting<OfflineState | null>("offline:v1", null);
  const group = data?.groups.find(
    (group) =>
      group.kind === "album" &&
      String(group.album?.id) === String(seed.id) &&
      group.album?.artistName === seed.artistName,
  );
  if (!data || !group) return;
  const tracks = group.tracks
    .map((id) => saved.find((track) => track.id === id) || data.jobs[id]?.track)
    .filter((track): track is Track => !!track)
    .map(localTrack);
  if (tracks.length !== group.tracks.length) return;
  const cover = tracks.find((track) => track.offlineCoverPath)?.cover;
  return {
    ...seed,
    ...(group.album || {}),
    ...(cover ? { cover_big: cover, cover_medium: cover } : {}),
    tracks,
    artistNames: [
      ...new Set(tracks.flatMap((track) => track.artists || [track.artist])),
    ],
    local: true,
  };
}
