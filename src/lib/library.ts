import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { persistentGet, persistentSet } from "./persistence";
import { syncSavedAudio } from "./cacheRegistry";
export type Source =
  | "Loud"
  | "Local"
  | "Apple Music"
  | "Spotify"
  | "Archive"
  | "Audius"
  | "Wikimedia"
  | "Live Music Archive"
  | "ccMixter"
  | "Jamendo"
  | "Deezer"
  | "SoundCloud"
  | "Lucida";
interface AudioCandidate {
  url: string;
  service?: string;
  quality?: "lossless" | "lossy";
  duration: number;
}
export interface Track {
  artists?: string[];
  fullRecording?: boolean;
  discNumber?: number;
  trackNumber?: number;
  playbackSource?: string;
  streamType?: "hls";
  streamCacheUrl?: string;
  streamCacheKey?: string;
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover: string;
  source: Source;
  src?: string;
  extractorUrl?: string;
  alternatives?: AudioCandidate[];
  qualityHint?: "lossless" | "lossy";
  appleId?: string;
  preview?: boolean;
  genre?: string;
  format?: string;
  sampleRate?: number;
  bitDepth?: number;
  remoteUrl?: string;
  nativeKey?: string;
  downloaded?: boolean;
  downloadAllowed?: boolean;
  license?: string;
  attributionUrl?: string;
  tags?: string[];
  recommendationReason?: string;
  inLibrary?: boolean;
}
export interface Playlist {
  id: string;
  name: string;
  tracks: string[];
}
export function recordingKey(track: Pick<Track, "title" | "artist">) {
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const artist = normalize(track.artist);
  let title = normalize(
    track.title
      .replace(
        /\s*[\[(](?:feat\.?|ft\.?|featuring)\s+([^\])]+)[\])]/gi,
        " feat $1",
      )
      .replace(/\s+(?:w\/|feat\.?|ft\.?|featuring)\s+/gi, " feat ")
      .replace(/^.*\s[-–—]\s\d{1,3}\s+(?=\p{L})/u, "")
      .replace(/\s*[\[(](?:live\b|remaster(?:ed)?\b)[^\])]*[\])]/gi, "")
      .replace(/\s+[-–—]\s+live\b.*$/i, ""),
  ).replace(/^\d+\s+(?=\p{L})/u, "");
  if (artist && title.startsWith(`${artist} `))
    title = title.slice(artist.length + 1).replace(/^\d+\s+(?=\p{L})/u, "");
  return `${artist}:${title}`;
}
let accountId = "legacy";
export function useLibraryAccount(id: string) {
  accountId = id;
  dbPromise = undefined;
}
function settingKey(key: string) {
  return accountId === "legacy"
    ? `loud:${key}`
    : `loud:account:${accountId}:${key}`;
}
export function readSetting<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(persistentGet(settingKey(key)) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveSetting(key: string, value: unknown) {
  persistentSet(settingKey(key), JSON.stringify(value));
}
let dbPromise: Promise<IDBDatabase> | undefined;
function database() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(
      accountId === "legacy" ? "loud-library" : `loud-library-${accountId}`,
      1,
    );
    request.onupgradeneeded = () =>
      request.result.createObjectStore("tracks", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function storeTracks(tracks: { track: Track; blob?: Blob }[]) {
  if ("__TAURI_INTERNALS__" in window) {
    await saveNativeTracks(accountId, tracks);
    if (tracks.some(({ track }) => track.downloaded || track.nativeKey))
      await syncSavedAudio();
    return;
  }
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("tracks", "readwrite");
    const store = tx.objectStore("tracks");
    tracks.forEach(({ track, blob }) => {
      if (blob)
        store.put({ id: track.id, track: { ...track, inLibrary: true }, blob });
      else {
        const previous = store.get(track.id);
        previous.onsuccess = () =>
          store.put({
            id: track.id,
            track: { ...track, inLibrary: true },
            blob: previous.result?.blob,
          });
      }
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  if (tracks.some(({ track }) => track.downloaded || track.nativeKey))
    await syncSavedAudio();
}
export async function restoreTracks(): Promise<Track[]> {
  if ("__TAURI_INTERNALS__" in window) {
    const rows = await invoke<NativeRecord[]>("library_load", {
      account: accountId,
    });
    await syncSavedAudio();
    return rows.map((row) => ({
      ...row.track,
      inLibrary: true,
      src: row.file
        ? convertFileSrc(row.file)
        : row.track.src?.startsWith("blob:")
          ? undefined
          : row.track.src,
    }));
  }
  const db = await database();
  return new Promise<Track[]>((resolve, reject) => {
    const req = db.transaction("tracks").objectStore("tracks").getAll();
    req.onsuccess = () =>
      resolve(
        req.result.map(({ track, blob }: { track: Track; blob?: Blob }) => ({
          ...track,
          inLibrary: true,
          src: blob ? URL.createObjectURL(blob) : track.src,
        })),
      );
    req.onerror = () => reject(req.error);
  }).then(async (tracks) => {
    await syncSavedAudio();
    return tracks;
  });
}
export async function storedAudio(id: string): Promise<Blob | undefined> {
  if ("__TAURI_INTERNALS__" in window) {
    const rows = await invoke<NativeRecord[]>("library_load", {
      account: accountId,
    });
    const file = rows.find((row) => row.track.id === id)?.file;
    if (!file) return;
    const response = await fetch(convertFileSrc(file));
    if (!response.ok)
      throw new Error("Не удалось прочитать локальный аудиофайл");
    return response.blob();
  }
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction("tracks").objectStore("tracks").get(id);
    request.onsuccess = () => resolve(request.result?.blob);
    request.onerror = () => reject(request.error);
  });
}
export const time = (seconds: number) =>
  `${Math.floor((Number.isFinite(seconds) ? seconds : 0) / 60)}:${Math.floor(
    (Number.isFinite(seconds) ? seconds : 0) % 60,
  )
    .toString()
    .padStart(2, "0")}`;

export function trackArtists(
  track: Pick<Track, "artist" | "artists">,
): string[] {
  const names = track.artists?.length
    ? track.artists
    : track.artist.split(/\s*(?:,|;|\bfeat\.?|\bft\.?)\s*/i);
  return [
    ...new Map(
      names
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => [name.normalize("NFKC").toLocaleLowerCase(), name]),
    ).values(),
  ];
}

interface NativeRecord {
  track: Track;
  file?: string;
}
async function saveNativeTracks(
  account: string,
  items: { track: Track; blob?: Blob }[],
) {
  for (const item of items) {
    const data = item.blob
      ? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(item.blob!);
        })
      : undefined;
    await invoke("library_save", {
      account,
      items: [{ track: item.track, data }],
    });
  }
}
export async function migrateNativeLibraries() {
  const accounts = JSON.parse(persistentGet("loud:accounts:v1") || "[]") as {
    id: string;
  }[];
  const databases = await indexedDB.databases();
  for (const account of accounts) {
    if (await invoke<boolean>("library_exists", { account: account.id }))
      continue;
    const name =
      account.id === "legacy" ? "loud-library" : `loud-library-${account.id}`;
    if (!databases.some((db) => db.name === name)) continue;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const rows = await new Promise<{ track: Track; blob?: Blob }[]>(
        (resolve, reject) => {
          const req = db.transaction("tracks").objectStore("tracks").getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        },
      );
      await saveNativeTracks(account.id, rows);
    } finally {
      db.close();
    }
  }
}
