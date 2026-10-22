import { cachedLyrics } from "./lyricsCache";
import { loadRmm } from "./rmmLyrics";
import { loadSpicy } from "./spicyLyrics";
import type { Track } from "./library";
import { additionalKaraoke, sameArtists } from "./wordLyrics";
import { catalogJSON } from "./catalogRequest";

interface LyricWord {
  time: number;
  end?: number;
  text: string;
}
export interface LyricLine {
  end?: number;
  words?: LyricWord[];
  time: number;
  text: string;
}
export interface Lyrics {
  id: number;
  lines?: LyricLine[];
  source?: string;
  sourceUrl?: string;
  recordingId?: string;
  credits?: { name: string; url: string }[];
  plainLyrics?: string;
  syncedLyrics?: string;
  instrumental?: boolean;
  trackName: string;
  artistName: string;
  duration: number;
}
const lrcTime = (m: RegExpMatchArray) =>
  Number(m[1]) * 60 + Number(m[2]) + Number(`0.${m[3] || 0}`);
export function parseLyrics(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [
      ...raw.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g),
    ];
    const content = raw.replace(/\[[^\]]*\]/g, "");
    const tags = [
      ...content.matchAll(/<(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?>/g),
    ];
    const text = content.replace(/<[^>]*>/g, "").trim();
    if (!text) continue;
    for (const stamp of stamps) {
      const words = tags.flatMap((tag, index) => {
        const next = tags[index + 1];
        const word = content.slice(tag.index! + tag[0].length, next?.index);
        return word
          ? [
              {
                time: lrcTime(tag),
                ...(next ? { end: lrcTime(next) } : {}),
                text: word,
              },
            ]
          : [];
      });
      lines.push({
        time: lrcTime(stamp),
        text,
        ...(words.length &&
        words
          .map((w) => w.text)
          .join("")
          .trim() === text
          ? { words }
          : {}),
      });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}
const seconds = (raw: string | null): number => {
  if (!raw) return NaN;
  if (raw.endsWith("ms")) return Number(raw.slice(0, -2)) / 1000;
  return raw
    .replace(/s$/, "")
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), 0);
};
export function parseTTML(xml: string): LyricLine[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) return [];
  return [...document.getElementsByTagNameNS("*", "p")]
    .flatMap((p) => {
      const time = seconds(p.getAttribute("begin"));
      const end = seconds(p.getAttribute("end"));
      const text = p.textContent?.trim() || "";
      if (!text || !Number.isFinite(time)) return [];
      const words = [...p.getElementsByTagNameNS("*", "span")].flatMap(
        (span) => {
          if (span.getElementsByTagNameNS("*", "span").length) return [];
          const time = seconds(span.getAttribute("begin"));
          const end = seconds(span.getAttribute("end"));
          const text = span.textContent || "";
          return text && Number.isFinite(time) && end > time
            ? [
                {
                  time,
                  end,
                  text:
                    text +
                    (span.nextSibling?.nodeType === 3
                      ? span.nextSibling.textContent || ""
                      : ""),
                },
              ]
            : [];
        },
      );
      return [
        {
          time,
          text,
          ...(Number.isFinite(end) ? { end } : {}),
          ...(words.length ? { words } : {}),
        },
      ];
    })
    .sort((a, b) => a.time - b.time);
}
interface PlusPayload {
  type?: string;
  metadata?: {
    title?: string;
    artist?: string;
    totalDuration?: string;
    source?: string;
  };
  lyrics?: {
    time: number;
    duration: number;
    text: string;
    syllabus?: { time: number; duration: number; text: string }[];
  }[];
}
function parsePlus(payload: PlusPayload): LyricLine[] {
  return (payload.lyrics || [])
    .flatMap((line) => {
      if (!Number.isFinite(line.time) || !line.text) return [];
      const words =
        payload.type === "Word"
          ? (line.syllabus || [])
              .filter(
                (w) =>
                  Number.isFinite(w.time) &&
                  w.duration > 0 &&
                  typeof w.text === "string",
              )
              .map((w) => ({
                time: w.time / 1000,
                end: (w.time + w.duration) / 1000,
                text: w.text,
              }))
          : [];
      return [
        {
          time: line.time / 1000,
          end: (line.time + line.duration) / 1000,
          text: line.text,
          ...(words.length ? { words } : {}),
        },
      ];
    })
    .sort((a, b) => a.time - b.time);
}
export function loadKaraoke(track: Track): Promise<Lyrics | undefined> {
  return cachedLyrics("words", track, () => fetchKaraoke(track));
}
async function fetchKaraoke(track: Track): Promise<Lyrics | undefined> {
  const params = new URLSearchParams({
    title: lyricTitle(track),
    artist: track.artist,
    duration: String(Math.round(track.duration)),
  });
  const plus = async (): Promise<Lyrics | undefined> => {
    const payload = await catalogJSON<PlusPayload>(
      "lyricsplus",
      `/v2/lyrics/get?${params}`,
    );
    const metadata = payload.metadata;
    const lines = parsePlus(payload);
    if (
      metadata?.title &&
      normalize(metadata.title) === normalize(lyricTitle(track)) &&
      metadata.artist &&
      sameArtists(metadata.artist, track.artist) &&
      lines.every((line) => (line.end ?? line.time) <= track.duration + 3) &&
      lines.some((l) => l.words?.length)
    )
      return {
        id: 0,
        trackName: track.title,
        artistName: track.artist,
        duration: track.duration,
        lines,
        source: "LyricsPlus",
        sourceUrl: "https://lyricsplus.binimum.org",
      };
  };
  const better = async (): Promise<Lyrics | undefined> => {
    const payload = await catalogJSON<{ ttml?: string }>(
      "betterlyrics",
      `/getLyrics?${new URLSearchParams({ s: lyricTitle(track), a: track.artist, d: String(Math.round(track.duration)) })}`,
    );
    const lines = payload.ttml ? parseTTML(payload.ttml) : [];
    if (lines.some((l) => l.words?.length))
      return {
        id: 0,
        trackName: track.title,
        artistName: track.artist,
        duration: track.duration,
        lines,
        source: "BetterLyrics",
        sourceUrl: "https://lyrics-api-docs.boidu.dev",
      };
  };
  class MissingWords extends Error {}
  let timer: ReturnType<typeof setTimeout>;
  const available = [
    loadRmm(track),
    loadSpicy(track),
    plus(),
    better(),
    ...additionalKaraoke(track),
  ].map(async (request) => {
    const value = await request.catch((error) => {
      if (/HTTP 404\b/.test(String(error))) throw new MissingWords();
      throw error;
    });
    if (!value) throw new MissingWords();
    return value;
  });
  try {
    return await Promise.race([
      Promise.any(available),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("Сервис пословного текста отвечает слишком долго."),
            ),
          45000,
        );
      }),
    ]);
  } catch (error) {
    if (
      error instanceof AggregateError &&
      error.errors.every((e) => e instanceof MissingWords)
    )
      return undefined;
    throw new Error(
      "Не удалось загрузить пословный текст. Можно повторить запрос.",
    );
  } finally {
    clearTimeout(timer!);
  }
}

const normalize = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function lyricTitle(track: Pick<Track, "title" | "artist">) {
  const artist = normalize(track.artist);
  const title = track.title.trim();
  const parts = title.split(/\s+[-–—]\s+/);
  return parts.length > 1 && normalize(parts[0]) === artist
    ? parts.slice(1).join(" - ").trim()
    : title;
}
function matchingLyrics(track: Track, entries: Lyrics[]): Lyrics | undefined {
  const title = normalize(lyricTitle(track)),
    artist = normalize(track.artist),
    original = normalize(track.title);
  return entries
    .filter((e) => {
      const named = normalize(e.trackName),
        performer = normalize(e.artistName);
      return (
        ((named === title && performer === artist) ||
          original === `${performer} ${named}`) &&
        Math.abs(e.duration - track.duration) <= 3
      );
    })
    .sort(
      (a, b) =>
        Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) ||
        Math.abs(a.duration - track.duration) -
          Math.abs(b.duration - track.duration),
    )[0];
}
export function loadLyrics(track: Track): Promise<Lyrics | undefined> {
  return cachedLyrics("lines", track, () => fetchLyrics(track));
}
async function fetchLyrics(track: Track): Promise<Lyrics | undefined> {
  if (!track.id) return;
  const title = lyricTitle(track);
  const params = new URLSearchParams({
    artist_name: track.artist,
    track_name: title,
    duration: String(Math.round(track.duration)),
  });
  try {
    const exact = await catalogJSON<Lyrics>("lrclib", `/api/get?${params}`);
    if (
      matchingLyrics(track, [exact]) &&
      (exact.syncedLyrics || exact.plainLyrics || exact.instrumental)
    )
      return exact;
  } catch {}
  const query =
    normalize(title) === normalize(track.title) &&
    normalize(track.title).startsWith(`${normalize(track.artist)} `)
      ? track.title
      : `${track.artist} ${title}`;
  let entries = await catalogJSON<Lyrics[]>(
    "lrclib",
    `/api/search?${new URLSearchParams({ q: query })}`,
  );
  if (!Array.isArray(entries))
    throw new Error("Lyrics service returned an invalid response.");
  let match = matchingLyrics(track, entries);
  if (!match && /\s[-–—]\s/.test(track.title)) {
    entries = await catalogJSON<Lyrics[]>(
      "lrclib",
      `/api/search?${new URLSearchParams({ q: track.title })}`,
    );
    if (Array.isArray(entries)) match = matchingLyrics(track, entries);
  }
  return match;
}
