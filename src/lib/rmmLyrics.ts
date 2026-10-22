import { invoke } from "@tauri-apps/api/core";
import { catalogJSON } from "./catalogRequest";
import type { Track } from "./library";
import { lyricTitle, parseTTML, type Lyrics } from "./lyrics";
import { sameArtists } from "./wordLyrics";

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
interface AppleSong {
  trackId: number;
  trackName: string;
  artistName: string;
  trackTimeMillis: number;
}
interface RmmPayload {
  id?: string;
  name?: string;
  artist?: string;
  duration?: number;
  isrc?: string;
  ttml?: string;
  ttmlTiming?: string;
  generated?: boolean;
  byModel?: boolean;
  lyricsProviderSource?: string;
  uploadAttribution?: {
    Uploader?: { username?: string; url?: string };
    Maker?: { username?: string; url?: string };
  };
}
function parseRmm(
  payload: RmmPayload,
  track: Track,
  appleId: string,
): Lyrics | undefined {
  if (
    String(payload.id) !== appleId ||
    !payload.name ||
    normalize(payload.name) !== normalize(lyricTitle(track)) ||
    !payload.artist ||
    !sameArtists(payload.artist, track.artist) ||
    !Number.isFinite(payload.duration) ||
    Math.abs(payload.duration! - track.duration) > 3 ||
    payload.generated ||
    payload.byModel ||
    !payload.ttml ||
    payload.ttmlTiming !== "word"
  )
    return;
  const lines = parseTTML(payload.ttml);
  if (
    !lines.some((line) => line.words?.length) ||
    lines.some(
      (line) => (line.end ?? line.time) > track.duration + 3 || line.time < 0,
    )
  )
    return;
  const credits = [
    payload.uploadAttribution?.Uploader,
    payload.uploadAttribution?.Maker,
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
    lines,
    credits,
    source:
      payload.lyricsProviderSource === "spicy_lyrics"
        ? "RMM Revival · Spicy Lyrics"
        : "RMM Revival",
    sourceUrl: "https://lyrics.rmmreviv.al",
    recordingId: payload.isrc,
  };
}
export async function loadRmm(track: Track): Promise<Lyrics | undefined> {
  let ids = track.appleId && /^\d+$/.test(track.appleId) ? [track.appleId] : [];
  if (
    !ids.length &&
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  ) {
    ids = await invoke<string[]>("apple_recordings", {
      title: lyricTitle(track),
      artist: track.artist,
    });
  }
  if (!ids.length) {
    const payload = await catalogJSON<{ results?: AppleSong[] }>(
      "itunes",
      `/search?${new URLSearchParams({ term: `${track.artist} ${lyricTitle(track)}`, entity: "song", limit: "12" })}`,
    );
    const songs = (payload.results || [])
      .filter(
        (song) =>
          normalize(song.trackName) === normalize(lyricTitle(track)) &&
          sameArtists(song.artistName, track.artist) &&
          Math.abs(song.trackTimeMillis / 1000 - track.duration) <= 3,
      )
      .sort(
        (a, b) =>
          Math.abs(a.trackTimeMillis / 1000 - track.duration) -
          Math.abs(b.trackTimeMillis / 1000 - track.duration),
      );
    if (!songs.length) return;
    ids = songs.slice(0, 4).map((song) => String(song.trackId));
  }
  const requests = ids
    .filter((id) => /^\d+$/.test(id))
    .map(async (appleId) => {
      const result = parseRmm(
        await catalogJSON<RmmPayload>("rmmrevival", `/lyrics?id=${appleId}`),
        track,
        appleId,
      );
      if (!result) throw new Error("No matching word lyrics");
      return result;
    });
  if (!requests.length) return;
  try {
    return await Promise.any(requests);
  } catch (error) {
    if (
      error instanceof AggregateError &&
      error.errors.every((item) =>
        /404\b|No matching word lyrics/.test(String(item)),
      )
    )
      return;
    throw error;
  }
}
