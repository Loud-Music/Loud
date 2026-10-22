import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import { lyricTitle, type Lyrics, type LyricLine } from "./lyrics";

interface Syllable {
  Text: string;
  StartTime: number;
  EndTime: number;
  IsPartOfWord?: boolean;
}
interface SpicyPayload {
  Status?: number;
  Body?: {
    Type?: string;
    id?: string;
    UploadAttribution?: {
      Uploader?: { username?: string; url?: string };
      Maker?: { username?: string; url?: string };
    };
    Content?: {
      Type?: string;
      Lead?: { Syllables?: Syllable[] };
      Text?: string;
      StartTime?: number;
      EndTime?: number;
    }[];
  };
}
function parseSpicy(payload: SpicyPayload, track: Track): Lyrics | undefined {
  const body = payload.Body;
  if (payload.Status !== 200 || body?.Type !== "Syllable") return;
  const lines: LyricLine[] = (body.Content || [])
    .flatMap((line) => {
      if (line.Type !== "Vocal") return [];
      const spans = line.Lead?.Syllables || [];
      if (
        !spans.length ||
        spans.some(
          (span) =>
            typeof span.Text !== "string" ||
            !Number.isFinite(span.StartTime) ||
            span.StartTime < 0 ||
            !(span.EndTime > span.StartTime) ||
            span.EndTime > track.duration + 3,
        )
      )
        return [];
      const words = spans.map((span, index) => ({
        time: span.StartTime,
        end: span.EndTime,
        text:
          span.Text +
          (!span.IsPartOfWord && index < spans.length - 1 ? " " : ""),
      }));
      return [
        {
          time: Math.min(...words.map((word) => word.time)),
          end: Math.max(...words.map((word) => word.end)),
          text: words.map((word) => word.text).join(""),
          words,
        },
      ];
    })
    .sort((a, b) => a.time - b.time);
  if (!lines.length) return;
  const credits = [
    body.UploadAttribution?.Uploader,
    body.UploadAttribution?.Maker,
  ].flatMap((person) =>
    person?.username && person.url?.startsWith("https://")
      ? [{ name: person.username, url: person.url }]
      : [],
  );
  return {
    id: 0,
    trackName: track.title,
    artistName: track.artist,
    duration: track.duration,
    source: "Spicy Lyrics",
    sourceUrl: "https://spicylyrics.org",
    credits,
    lines,
  };
}
export async function loadSpicy(track: Track): Promise<Lyrics | undefined> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window))
    return;
  const payload = await invoke<SpicyPayload | null>("spicy_lyrics", {
    title: lyricTitle(track),
    artist: track.artist,
    duration: track.duration,
  });
  return payload ? parseSpicy(payload, track) : undefined;
}
