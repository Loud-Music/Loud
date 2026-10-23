import { findArtist, artistKey, type Artist } from "./artists";
import { appleArtistImage } from "./appleCatalog";
import { catalogJSON } from "./catalogRequest";
import { persistentGet, persistentSet } from "./persistence";
import { appleWebArtists } from "./appleWeb";

const pending = new Map<string, Promise<string | undefined>>();
let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(task: () => Promise<T>) {
  if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
export function forgetPortrait(name: string) {
  const entries = saved();
  delete entries[artistKey(name)];
  persistentSet(cacheKey, JSON.stringify(entries));
}
const cacheKey = "loud:artist-portraits:v1";
type Saved = Record<string, { url: string; at: number }>;
function saved(): Saved {
  try {
    const value = JSON.parse(persistentGet(cacheKey) || "{}");
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, Saved[string]] => {
          const item = entry[1] as Saved[string] | null;
          return (
            !!item &&
            typeof item.url === "string" &&
            item.url.startsWith("https://") &&
            Number.isFinite(item.at)
          );
        },
      ),
    );
  } catch {
    return {};
  }
}
async function applePortrait(name: string) {
  const response = await catalogJSON<{
    results: { artistId: number; artistName: string }[];
  }>(
    "itunes",
    `/search?${new URLSearchParams({ term: name, entity: "musicArtist", limit: "8", country: "us" })}`,
  );
  const artist = response.results?.find(
    (item) => artistKey(item.artistName) === artistKey(name),
  );
  if (!artist) throw new Error("Artist not found");
  const image = await appleArtistImage(artist.artistId);
  if (!image) throw new Error("Portrait unavailable");
  return image;
}
export function artistPortrait(name: string, hint?: Artist, retry = false) {
  const key = artistKey(name);
  if (retry) pending.delete(key);
  const existing = pending.get(key);
  if (existing) return existing;
  const cached = saved()[key];
  if (!retry && cached && Date.now() - cached.at < 7 * 86400000)
    return Promise.resolve(cached.url);
  const request = limited(async () => {
    const deezer = (async () => {
      const artist = hint || (await findArtist(name));
      const image = artist?.picture_xl || artist?.picture_big;
      if (!image) throw new Error("Portrait unavailable");
      return image;
    })();
    const web = appleWebArtists(name).then((artists) => {
      const image = artists.find(
        (item) => artistKey(item.name) === key,
      )?.picture_xl;
      if (!image) throw new Error("Portrait unavailable");
      return image;
    });
    return Promise.any([deezer, applePortrait(name), web])
      .then((url) => {
        if (!url.startsWith("https://")) return undefined;
        const entries = saved();
        entries[key] = { url, at: Date.now() };
        persistentSet(
          cacheKey,
          JSON.stringify(
            Object.fromEntries(
              Object.entries(entries)
                .sort((a, b) => b[1].at - a[1].at)
                .slice(0, 128),
            ),
          ),
        );
        return url;
      })
      .catch(() => cached?.url);
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}
