import { invoke } from "@tauri-apps/api/core";
import {
  readSetting,
  saveSetting,
  storeTracks,
  type Playlist,
  type Track,
  type Source,
} from "./library";
import { flushPersistence } from "./persistence";
import { normalizeEqualizer } from "./equalizer";
import {
  emptyTaste,
  type TasteProfile,
  type Feedback,
} from "./recommendations";

export interface ProfileBackup {
  format: "loud-profile";
  version: 1;
  createdAt: string;
  name: string;
  tracks: Track[];
  settings: Record<string, unknown>;
}
const maxBackupBytes = 32 * 1024 * 1024;
const maxBackupTracks = 50000;

function checkBackupSize(bytes: number) {
  if (bytes > maxBackupBytes) throw new Error("Копия профиля превышает 32 МБ.");
}

function checkTrackCount(count: number) {
  if (count > maxBackupTracks)
    throw new Error("Копия профиля поддерживает до 50 000 треков.");
}

const keys = [
  "favorites",
  "playlists",
  "followedArtists:v1",
  "taste:v1",
  "theme:v2",
  "performanceMode:v1",
  "volume",
  "gapless:v1",
  "equalizer:v1",
  "exclusiveOutput",
];
const sources: Source[] = [
  "Loud",
  "Local",
  "Apple Music",
  "Spotify",
  "Archive",
  "Audius",
  "Wikimedia",
  "Live Music Archive",
  "ccMixter",
  "Jamendo",
  "Deezer",
  "SoundCloud",
  "YouTube Music",
  "Lucida",
  "JioSaavn",
];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, limit = 2000): value is string =>
  typeof value === "string" && value.length <= limit;
function strings(value: unknown, limit = 50000): string[] {
  if (
    !Array.isArray(value) ||
    value.length > limit ||
    !value.every((item) => string(item) && item.length > 0)
  )
    throw new Error("В копии повреждён список записей.");
  return [...new Set(value)];
}
function https(value: unknown) {
  if (!string(value, 8000)) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {}
}
function track(value: unknown): Track {
  if (
    !object(value) ||
    !string(value.id, 512) ||
    !value.id ||
    !string(value.title) ||
    !string(value.artist) ||
    !string(value.album) ||
    typeof value.duration !== "number" ||
    !Number.isFinite(value.duration) ||
    value.duration < 0 ||
    !sources.includes(value.source as Source)
  )
    throw new Error("В копии повреждены данные трека.");
  const extractorUrl = https(value.extractorUrl);
  return {
    id: value.id,
    title: value.title,
    artist: value.artist,
    album: value.album,
    duration: value.duration,
    source: value.source as Source,
    cover: https(value.cover) || "/covers/imported.svg",
    artists: Array.isArray(value.artists)
      ? strings(value.artists, 40)
      : undefined,
    src: extractorUrl || https(value.remoteUrl) || https(value.src),
    extractorUrl,
    remoteUrl: https(value.remoteUrl),
    attributionUrl: https(value.attributionUrl),
    format: string(value.format, 30) ? value.format : undefined,
    license: string(value.license) ? value.license : undefined,
    genre: string(value.genre, 150) ? value.genre : undefined,
    tags: Array.isArray(value.tags) ? strings(value.tags, 100) : undefined,
    qualityHint: value.qualityHint === "lossless" ? "lossless" : "lossy",
    fullRecording: value.fullRecording === true,
    preview: value.preview === true,
    downloadAllowed: value.downloadAllowed !== false,
    availableAt:
      string(value.availableAt, 60) &&
      Number.isFinite(Date.parse(value.availableAt))
        ? value.availableAt
        : undefined,
    loudReleaseId:
      Number.isSafeInteger(value.loudReleaseId) &&
      (value.loudReleaseId as number) > 0
        ? (value.loudReleaseId as number)
        : undefined,
    loudArtistIds: Array.isArray(value.loudArtistIds)
      ? value.loudArtistIds
          .filter((id): id is number => Number.isSafeInteger(id) && id > 0)
          .slice(0, 40)
      : undefined,
    trackNumber: Number.isSafeInteger(value.trackNumber)
      ? (value.trackNumber as number)
      : undefined,
    discNumber: Number.isSafeInteger(value.discNumber)
      ? (value.discNumber as number)
      : undefined,
    inLibrary: true,
  };
}
function playlists(value: unknown): Playlist[] {
  if (!Array.isArray(value) || value.length > 5000)
    throw new Error("В копии повреждён список плейлистов.");
  const ids = new Set<string>();
  return value.map((item) => {
    if (
      !object(item) ||
      !string(item.id, 200) ||
      !item.id ||
      ids.has(item.id) ||
      !string(item.name, 500)
    )
      throw new Error("В копии повреждены данные плейлиста.");
    ids.add(item.id);
    return { id: item.id, name: item.name, tracks: strings(item.tracks) };
  });
}
function taste(value: Record<string, unknown>): TasteProfile {
  const weights = (value: unknown) =>
    object(value)
      ? (Object.fromEntries(
          Object.entries(value)
            .slice(0, 10000)
            .filter(
              ([key, weight]) =>
                key.length <= 2000 &&
                typeof weight === "number" &&
                Number.isFinite(weight) &&
                Math.abs(weight) <= 1000000,
            ),
        ) as Record<string, number>)
      : {};
  const history: TasteProfile["history"] = [];
  if (Array.isArray(value.history))
    for (const item of value.history.slice(-2000)) {
      if (
        object(item) &&
        string(item.id) &&
        string(item.album) &&
        string(item.artist) &&
        ["like", "unlike", "listen", "skip", "dislike"].includes(
          String(item.event),
        ) &&
        typeof item.at === "number" &&
        Number.isFinite(item.at)
      )
        history.push({
          id: item.id,
          album: item.album,
          artist: item.artist,
          event: item.event as Feedback,
          at: item.at,
          recording: string(item.recording) ? item.recording : undefined,
        });
    }
  return {
    ...emptyTaste(),
    genres: Array.isArray(value.genres) ? strings(value.genres, 100) : [],
    genreWeights: weights(value.genreWeights),
    artistWeights: weights(value.artistWeights),
    blockedReleases: Array.isArray(value.blockedReleases)
      ? strings(value.blockedReleases)
      : [],
    history,
    mix:
      value.mix === "familiar" || value.mix === "discovery"
        ? value.mix
        : "balanced",
    energy:
      value.energy === "calm" || value.energy === "energetic"
        ? value.energy
        : "all",
  };
}
function settings(value: unknown): Record<string, unknown> {
  if (!object(value)) throw new Error("В копии нет настроек профиля.");
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const item = value[key];
    if (item === undefined || item === null) continue;
    if (["favorites", "followedArtists:v1"].includes(key))
      result[key] = strings(item);
    else if (key === "playlists") result[key] = playlists(item);
    else if (key === "taste:v1" && object(item)) result[key] = taste(item);
    else if (key === "equalizer:v1" && object(item))
      result[key] = normalizeEqualizer(item);
    else if (
      key === "volume" &&
      typeof item === "number" &&
      Number.isFinite(item)
    )
      result[key] = Math.min(1, Math.max(0, item));
    else if (key === "theme:v2" && ["light", "dark"].includes(String(item)))
      result[key] = item;
    else if (
      key === "performanceMode:v1" &&
      ["normal", "potato"].includes(String(item))
    )
      result[key] = item;
    else if (
      ["gapless:v1", "exclusiveOutput"].includes(key) &&
      typeof item === "boolean"
    )
      result[key] = item;
  }
  return result;
}
export async function exportProfile(
  account: { id: string; name: string },
  tracks: Track[],
) {
  await flushPersistence();
  const stored =
    "__TAURI_INTERNALS__" in window
      ? (
          await invoke<{ track: Track }[]>("library_load", {
            account: account.id,
          })
        ).map((row) => row.track)
      : tracks;
  const unique = new Map(stored.map((item) => [item.id, item]));
  checkTrackCount(unique.size);
  const backup: ProfileBackup = {
    format: "loud-profile",
    version: 1,
    createdAt: new Date().toISOString(),
    name: account.name,
    tracks: Array.from(unique.values(), track),
    settings: settings(
      Object.fromEntries(keys.map((key) => [key, readSetting(key, null)])),
    ),
  };
  const file = new Blob([JSON.stringify(backup)], { type: "application/json" });
  checkBackupSize(file.size);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `LOUD-${account.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")}-${new Date().toISOString().slice(0, 10)}.loudbackup`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function readProfileBackup(file: File): Promise<ProfileBackup> {
  checkBackupSize(file.size);
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error("Не удалось прочитать копию профиля.");
  }
  if (
    !object(value) ||
    value.format !== "loud-profile" ||
    value.version !== 1 ||
    !string(value.name, 100) ||
    !string(value.createdAt, 60) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.tracks)
  )
    throw new Error("Файл не является поддерживаемой копией профиля LOUD.");
  checkTrackCount(value.tracks.length);
  return {
    format: "loud-profile",
    version: 1,
    name: value.name,
    createdAt: value.createdAt,
    tracks: [
      ...new Map(
        value.tracks.map((item) => {
          const entry = track(item);
          return [entry.id, entry] as const;
        }),
      ).values(),
    ],
    settings: settings(value.settings),
  };
}
export async function restoreProfileBackup(
  backup: ProfileBackup,
  current: Track[],
) {
  const existing = new Map(current.map((item) => [item.id, item]));
  await storeTracks(
    backup.tracks.map((item) => ({ track: existing.get(item.id) || item })),
  );
  for (const [key, value] of Object.entries(backup.settings)) {
    if (key === "favorites" || key === "followedArtists:v1")
      saveSetting(key, [
        ...new Set([...readSetting<string[]>(key, []), ...(value as string[])]),
      ]);
    else if (key === "playlists") {
      const merged = new Map(
        readSetting<Playlist[]>(key, []).map((item) => [item.id, item]),
      );
      for (const item of value as Playlist[]) {
        const old = merged.get(item.id);
        merged.set(
          item.id,
          old
            ? { ...old, tracks: [...new Set([...old.tracks, ...item.tracks])] }
            : item,
        );
      }
      saveSetting(key, [...merged.values()]);
    } else saveSetting(key, value);
    await flushPersistence();
  }
}
