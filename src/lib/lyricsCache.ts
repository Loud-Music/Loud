import type { Track } from "./library";
import type { Lyrics } from "./lyrics";

type Kind = "words" | "lines";
const pending = new Map<string, Promise<Lyrics | undefined>>();
const missing = new Map<string, number>();
let database: Promise<IDBDatabase> | undefined;
const memory = new Map<string, { at: number; value: Lyrics }>();
function remember(key: string, value: Lyrics, at = Date.now()) {
  memory.delete(key);
  memory.set(key, { at, value });
  if (memory.size > 128) memory.delete(memory.keys().next().value!);
}
export function readyLyrics(track: Track): Lyrics | undefined {
  return (
    memory.get(identity("words", track))?.value ||
    memory.get(identity("lines", track))?.value
  );
}
const identity = (kind: Kind, track: Track) =>
  JSON.stringify([
    kind,
    track.artist.normalize("NFKC").toLowerCase().trim(),
    track.title.normalize("NFKC").toLowerCase().trim(),
    Math.round(track.duration),
  ]);
function open() {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("No lyric cache"));
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("loud-lyrics", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("lyrics");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  }));
}
async function read(
  key: string,
): Promise<{ at: number; value: Lyrics } | undefined> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const request = db.transaction("lyrics").objectStore("lyrics").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}
async function write(key: string, value: Lyrics) {
  try {
    const db = await open();
    const tx = db.transaction("lyrics", "readwrite");
    tx.objectStore("lyrics").put({ at: Date.now(), value }, key);
  } catch {}
}
export function cachedLyrics(
  kind: Kind,
  track: Track,
  load: () => Promise<Lyrics | undefined>,
) {
  const key = identity(kind, track);
  const ready = memory.get(key);
  if (ready && Date.now() - ready.at < 7 * 86400000)
    return Promise.resolve(ready.value);
  const old = pending.get(key);
  if (old) return old;
  if (Date.now() < (missing.get(key) || 0)) return Promise.resolve(undefined);
  let request!: Promise<Lyrics | undefined>;
  request = (async () => {
    const stored = await read(key);
    if (stored && Date.now() - stored.at < 7 * 86400000) {
      remember(key, stored.value, stored.at);
      return stored.value;
    }
    try {
      const value = await load();
      if (value && pending.get(key) === request) {
        missing.delete(key);
        remember(key, value);
        void write(key, value);
      } else if (!value && !stored && pending.get(key) === request) {
        missing.set(key, Date.now() + 60000);
        if (missing.size > 256) missing.delete(missing.keys().next().value!);
      }
      return value || stored?.value;
    } catch (error) {
      if (stored) return stored.value;
      throw error;
    }
  })();
  pending.set(key, request);
  void request
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    })
    .catch(() => {});
  return request;
}
export async function clearLyricsCache(track: Track) {
  for (const kind of ["words", "lines"] as const) {
    pending.delete(identity(kind, track));
    memory.delete(identity(kind, track));
    missing.delete(identity(kind, track));
  }
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("lyrics", "readwrite");
      for (const kind of ["words", "lines"] as const)
        tx.objectStore("lyrics").delete(identity(kind, track));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}
