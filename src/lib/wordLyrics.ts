import { catalogJSON } from "./catalogRequest";
import type { Track } from "./library";
import { lyricTitle, parseTTML, type Lyrics, type LyricLine } from "./lyrics";

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function sameArtists(candidate: string, wanted: string) {
  const split = (value: string) =>
    value
      .split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?)\s*/i)
      .map(normalize)
      .filter(Boolean);
  const artists = split(candidate);
  return split(wanted).every((artist) => artists.includes(artist));
}
interface MuxPayload {
  track?: { title?: string; artist?: string; duration?: number; isrc?: string };
  meta?: { level?: string; generated?: boolean; source?: { name?: string } };
  lines?: {
    text: string;
    start: number;
    end: number;
    words?: { text: string; start: number; end: number }[];
  }[];
}
function parseMux(payload: MuxPayload, track: Track): LyricLine[] {
  const info = payload.track;
  if (
    !info?.title ||
    !info.artist ||
    normalize(info.title) !== normalize(lyricTitle(track)) ||
    !sameArtists(info.artist, track.artist) ||
    !Number.isFinite(info.duration) ||
    Math.abs(info.duration! - track.duration) > 3 ||
    payload.meta?.generated ||
    payload.meta?.level !== "word"
  )
    return [];
  return (payload.lines || []).flatMap((line) => {
    const words = (line.words || [])
      .filter(
        (word) =>
          typeof word.text === "string" &&
          Number.isFinite(word.start) &&
          word.end > word.start &&
          word.start >= 0 &&
          word.end <= (track.duration + 3) * 1000,
      )
      .map((word, index, all) => ({
        text: word.text + (index < all.length - 1 ? " " : ""),
        time: word.start / 1000,
        end: word.end / 1000,
      }));
    if (
      !words.length ||
      !Number.isFinite(line.start) ||
      line.end <= line.start ||
      normalize(words.map((word) => word.text).join("")) !==
        normalize(line.text)
    )
      return [];
    return [
      { time: line.start / 1000, end: line.end / 1000, text: line.text, words },
    ];
  });
}
export function additionalKaraoke(track: Track): Promise<Lyrics | undefined>[] {
  const result = (
    lines: LyricLine[],
    source: string,
    sourceUrl: string,
  ): Lyrics | undefined =>
    lines.some((line) => line.words?.length)
      ? {
          id: 0,
          trackName: track.title,
          artistName: track.artist,
          duration: track.duration,
          lines,
          source,
          sourceUrl,
        }
      : undefined;
  const mux = async () => {
    const payload = await catalogJSON<MuxPayload>(
      "lrcmux",
      `/get?${new URLSearchParams({ title: lyricTitle(track), artist: track.artist, duration: String(Math.round(track.duration)), format: "json", level: "word" })}`,
    );
    return result(parseMux(payload, track), "LRCMux", "https://lrcmux.dev");
  };
  const amll = async () => {
    const payload = await catalogJSON<{
      data?: {
        items?: {
          id: string;
          musicNames?: string[];
          artistNames?: string[];
          authorUsernames?: string[];
        }[];
      };
    }>(
      "amll",
      `/v1/lyrics/search?${new URLSearchParams({ trackName: lyricTitle(track), artistName: track.artist })}`,
    );
    const candidates =
      payload.data?.items?.filter(
        (item) =>
          item.musicNames?.some(
            (name) => normalize(name) === normalize(lyricTitle(track)),
          ) &&
          item.artistNames?.some((artist) => sameArtists(artist, track.artist)),
      ) || [];
    if (candidates.length !== 1) return;
    const candidate = candidates[0];
    const detail = await catalogJSON<{
      data?: { lyrics?: string; ttml?: string; content?: string };
    }>("amll", `/v1/lyrics/get?${new URLSearchParams({ id: candidate.id })}`);
    const xml =
      detail.data?.lyrics || detail.data?.ttml || detail.data?.content;
    if (!xml) return;
    const lines = parseTTML(xml);
    if (lines.some((line) => (line.end ?? line.time) > track.duration + 3))
      return;
    return result(
      lines,
      `AMLL${candidate.authorUsernames?.length ? ` · ${candidate.authorUsernames.join(", ")}` : ""}`,
      "https://github.com/amll-dev/amll-ttml-db",
    );
  };
  return [mux(), amll()];
}
