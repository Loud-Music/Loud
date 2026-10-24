import type { Track } from "./library";

export function sourcePriority(
  track: Pick<Track, "source" | "extractorUrl" | "src" | "playbackSource">,
) {
  if (track.source === "Loud") return -1;
  try {
    const host = new URL(
      track.playbackSource || track.extractorUrl || track.src || "",
    ).hostname;
    if (/^music\.amazon\./.test(host)) return 0;
    if (host === "soundcloud.com" || host.endsWith(".sndcdn.com")) return 2;
  } catch {}
  return track.source === "Lucida" ? 1 : 2;
}
