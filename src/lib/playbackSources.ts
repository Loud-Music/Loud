import { invoke } from "@tauri-apps/api/core";
import { readSetting, saveSetting, type Track } from "./library";

interface SourceSettings {
  jiosaavn: boolean;
  cobalt: { endpoint: string; apiKey: string };
}

export function playbackSources(): SourceSettings {
  const saved = readSetting<Partial<SourceSettings>>(
    "playback-sources-config:v1",
    {},
  );
  return {
    jiosaavn: saved.jiosaavn !== false,
    cobalt: {
      endpoint:
        typeof saved.cobalt?.endpoint === "string" ? saved.cobalt.endpoint : "",
      apiKey:
        typeof saved.cobalt?.apiKey === "string" ? saved.cobalt.apiKey : "",
    },
  };
}

export function savePlaybackSources(value: SourceSettings) {
  saveSetting("playback-sources-config:v1", value);
  window.dispatchEvent(new Event("loud-playback-sources-changed"));
}

interface SaavnSong {
  id: string;
  title: string;
  perma_url: string;
  image?: string;
  more_info?: {
    duration?: string | number;
    album?: string;
    artists?: { primary?: { name: string }[]; featured?: { name: string }[] };
  };
}

const text = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
let unavailableUntil = 0;

export async function searchJioSaavn(query: string): Promise<Track[]> {
  if (
    !("__TAURI_INTERNALS__" in window) ||
    !playbackSources().jiosaavn ||
    Date.now() < unavailableUntil
  )
    return [];
  try {
    const result = await invoke<{ results?: SaavnSong[] }>("jiosaavn_search", {
      query,
    });
    if (!Array.isArray(result.results))
      throw new Error("Некорректный ответ JioSaavn");
    return result.results.slice(0, 10).flatMap((song): Track[] => {
      if (!song || typeof song !== "object") return [];
      const duration = Number(song.more_info?.duration);
      const credits = song.more_info?.artists;
      const artists = [
        ...(Array.isArray(credits?.primary) ? credits.primary : []),
        ...(Array.isArray(credits?.featured) ? credits.featured : []),
      ]
        .filter((artist) => typeof artist?.name === "string")
        .map((artist) => text(artist.name));
      if (
        typeof song.id !== "string" ||
        typeof song.title !== "string" ||
        !artists.length ||
        !Number.isFinite(duration) ||
        duration <= 30 ||
        typeof song.perma_url !== "string" ||
        !/^https:\/\/(?:www\.)?jiosaavn\.com\/song\/[^/]+\/[\w,-]+$/.test(
          song.perma_url,
        )
      )
        return [];
      const cover =
        typeof song.image === "string" &&
        /^https:\/\/[\w.-]+\.saavncdn\.com\//.test(song.image)
          ? song.image.replace(/150x150/g, "500x500")
          : "/covers/imported.svg";
      return [
        {
          id: `jiosaavn:${song.id}`,
          title: text(song.title),
          artist: artists.join(", "),
          artists,
          album:
            typeof song.more_info?.album === "string"
              ? text(song.more_info.album)
              : text(song.title),
          duration,
          cover,
          source: "JioSaavn",
          format: "AAC",
          qualityHint: "lossy",
          src: song.perma_url,
          extractorUrl: song.perma_url,
          attributionUrl: song.perma_url,
          downloadAllowed: true,
        },
      ];
    });
  } catch (error) {
    unavailableUntil = Date.now() + 60000;
    throw error;
  }
}
