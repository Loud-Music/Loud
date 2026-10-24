import { playbackLog } from "./playbackLog";
import { sourcePriority } from "./sourcePriority";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { chooseStream, sameRecording } from "./streamResolver";
import { readSetting, saveSetting, trackArtists, type Track } from "./library";
import { catalogJSON } from "./catalogRequest";

interface ExtractedTrack {
  id: string;
  title: string;
  uploader?: string;
  artist?: string;
  album?: string;
  duration?: number;
  webpage_url?: string;
  thumbnail?: string;
  thumbnails?: { url: string }[];
  availability?: string;
}
function extractedTracks(
  data: { entries?: ExtractedTrack[] } & Partial<ExtractedTrack>,
  youtube = false,
): Track[] {
  return (data.entries || (data.id ? [data as ExtractedTrack] : [])).flatMap(
    (item) => {
      const url = youtube
        ? /^[a-zA-Z0-9_-]{11}$/.test(item.id)
          ? `https://www.youtube.com/watch?v=${item.id}`
          : undefined
        : item.webpage_url;
      if (
        !url ||
        (!youtube &&
          !/^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+$/.test(url)) ||
        !item.duration ||
        item.duration <= 30 ||
        ["premium_only", "subscriber_only", "private", "needs_auth"].includes(
          item.availability || "",
        )
      )
        return [];
      return [
        {
          id: `${youtube ? "youtube" : "soundcloud"}:${item.id}`,
          title: item.title,
          artist: item.artist || item.uploader || "Неизвестный исполнитель",
          album: item.album || item.title,
          duration: item.duration,
          source: youtube
            ? ("YouTube Music" as const)
            : ("SoundCloud" as const),
          format: "Аудио",
          cover:
            item.thumbnail ||
            item.thumbnails?.at(-1)?.url ||
            "/covers/imported.svg",
          src: url,
          extractorUrl: url,
          attributionUrl: url,
          downloadAllowed: true,
        },
      ];
    },
  );
}
export async function searchExtracted(
  query: string,
  source: "soundcloud" | "youtube" = "soundcloud",
) {
  if (!("__TAURI_INTERNALS__" in window)) return [];
  return extractedTracks(
    await invoke("extractor_search", { query, source }),
    source === "youtube",
  );
}
interface AudioFile {
  cacheKey?: string;
  cacheUrl?: string;
  key: string;
  path?: string;
  url?: string;
  hls?: boolean;
  size: number;
  duration: number;
  format: string;
  sampleRate?: number;
  bitDepth?: number;
}
const audioQuality = (format?: string) =>
  format === "FLAC" ? 4 : format === "MP3" ? 3 : format === "AAC" ? 2 : 1;
const pending = new Map<string, Promise<Track>>();
const audioCacheIdentity = (track: Track) =>
  JSON.stringify(
    [track.artist, track.title].map((value) =>
      value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim(),
    ),
  );
interface SourceHint {
  url: string;
  duration: number;
  quality?: "lossless" | "lossy";
  at: number;
}
function savedSources(track: Track) {
  const sources = readSetting<Record<string, SourceHint[]>>(
    "playback-sources:v1",
    {},
  );
  return (sources[audioCacheIdentity(track)] || []).filter(
    (hint) =>
      Date.now() - hint.at < 30 * 86400000 &&
      Math.abs(hint.duration - track.duration) <= 3,
  );
}
function rememberSource(track: Track, resolved: Track) {
  const url = resolved.playbackSource;
  if (!url) return;
  const host = new URL(url).hostname;
  if (
    !/^music\.amazon\./.test(host) &&
    ![
      "soundcloud.com",
      "www.youtube.com",
      "open.qobuz.com",
      "play.qobuz.com",
      "www.qobuz.com",
      "tidal.com",
      "listen.tidal.com",
      "deezer.com",
      "www.deezer.com",
      "music.yandex.ru",
      "music.yandex.com",
    ].includes(host)
  )
    return;
  const sources = readSetting<Record<string, SourceHint[]>>(
    "playback-sources:v1",
    {},
  );
  const key = audioCacheIdentity(track);
  const hint: SourceHint = {
    url,
    duration: resolved.duration,
    quality: resolved.format === "FLAC" ? "lossless" : "lossy",
    at: Date.now(),
  };
  sources[key] = [
    hint,
    ...(sources[key] || []).filter((hint) => hint.url !== url),
  ].slice(0, 3);
  saveSetting(
    "playback-sources:v1",
    Object.fromEntries(
      Object.entries(sources)
        .sort((a, b) => (b[1][0]?.at || 0) - (a[1][0]?.at || 0))
        .slice(0, 256),
    ),
  );
}

const streamCaching = new Set<string>();
const upgrading = new Map<string, number>();
async function warmLossless(track: Track) {
  const key = audioCacheIdentity(track);
  if (Date.now() < (upgrading.get(key) || 0)) return;
  upgrading.set(key, Date.now() + 300000);
  try {
    const candidates = await queryLucida(
      `${trackArtists(track)[0] || track.artist} ${track.title}`,
      "amazon",
      true,
    );
    const candidate =
      candidates
        .filter(
          (item) => sameRecording(track, item) && sourcePriority(item) < 2,
        )
        .sort((a, b) => sourcePriority(a) - sourcePriority(b))[0] ||
      (sourcePriority(track) < 2 ? track : undefined);
    if (!candidate?.extractorUrl) return;
    const file = await invoke<AudioFile>("extractor_stream", {
      url: candidate.extractorUrl,
      duration: track.duration,
      recording: key,
    });
    playbackLog("lossless-cache-warming", track, { format: file.format });
  } catch (error) {
    playbackLog("lossless-cache-failed", track, { error });
  }
}
export function cachePlayingStream(track: Track, resolved: Track) {
  if (
    !("__TAURI_INTERNALS__" in window) ||
    !resolved.src ||
    resolved.streamType
  )
    return;
  if (resolved.streamCacheKey && resolved.src.startsWith("http://127.0.0.1:"))
    return;
  const url = resolved.streamCacheUrl || resolved.src;
  try {
    const host = new URL(url).hostname;
    if (host !== "api.audius.co" && !host.endsWith(".lucida.to")) return;
  } catch {
    return;
  }
  const key = audioCacheIdentity(track);
  if (streamCaching.has(key)) return;
  streamCaching.add(key);
  void invoke<AudioFile>("extractor_cache_stream", {
    url,
    duration: track.duration,
    recording: key,
  })
    .then(
      (file) => {
        playbackLog("stream-cache-ready", track, {
          format: file.format,
          size: file.size,
        });
      },
      (error) => {
        streamCaching.delete(key);
        playbackLog("stream-cache-failed", track, { error });
      },
    )
    .finally(() => streamCaching.delete(key));
}
interface StreamJob {
  expires: number;
  promise: Promise<Track>;
  listeners: Set<(track: Track) => void>;
  prepared?: Track;
}
const streamJobs = new Map<string, StreamJob>();
const warmedAudio = new Map<string, number>();
let prefetchRunning = 0;
const queuedPrefetch = new Map<string, Track>();
let intentTimer: ReturnType<typeof setTimeout>;
export function prepareAudio(track: Track) {
  clearTimeout(intentTimer);
  intentTimer = setTimeout(() => prefetchAudio(track), 60);
}
export function cancelAudioPreparation() {
  clearTimeout(intentTimer);
}
export function needsAudioResolution(track: Track) {
  if (track.downloaded) return false;
  if (track.extractorUrl) return true;
  return (
    "__TAURI_INTERNALS__" in window &&
    track.source === "Audius" &&
    /^https:\/\/api\.audius\.co\/v1\/tracks\/[a-zA-Z0-9]+\/stream(?:\?|$)/.test(
      track.src || "",
    )
  );
}
export function prefetchAudio(track: Track) {
  if (
    !("__TAURI_INTERNALS__" in window) ||
    !needsAudioResolution(track) ||
    track.preview
  )
    return;
  const key = audioCacheIdentity(track);
  if (Date.now() < (warmedAudio.get(key) || 0)) return;
  if (prefetchRunning >= 2) {
    queuedPrefetch.set(key, track);
    if (queuedPrefetch.size > 3)
      queuedPrefetch.delete(queuedPrefetch.keys().next().value!);
    return;
  }
  prefetchRunning++;
  warmedAudio.set(key, Date.now() + 180000);
  if (warmedAudio.size > 256)
    warmedAudio.delete(warmedAudio.keys().next().value!);
  void resolveExtracted(track, true)
    .then((resolved) => cachePlayingStream(track, resolved))
    .catch((error) => {
      warmedAudio.delete(key);
      playbackLog("prefetch-failed", track, { error });
    })
    .finally(() => {
      prefetchRunning--;
      while (prefetchRunning < 2 && queuedPrefetch.size) {
        const next = queuedPrefetch.entries().next().value!;
        queuedPrefetch.delete(next[0]);
        prefetchAudio(next[1]);
      }
    });
}
export async function resolveExtracted(
  track: Track,
  streaming = false,
  excluded: readonly string[] = [],
  prepared?: (track: Track) => void,
): Promise<Track> {
  if (!needsAudioResolution(track)) return track;
  if (!("__TAURI_INTERNALS__" in window))
    throw new Error("Полные треки доступны в приложении Loud для компьютера.");
  playbackLog("resolve-start", track, { streaming, excluded: excluded.length });
  const warmKey = `${audioCacheIdentity(track)}:${Math.round(track.duration)}`;
  const warmed =
    streaming && !excluded.length ? streamJobs.get(warmKey) : undefined;
  if (warmed && Date.now() < warmed.expires) {
    if (prepared) {
      warmed.listeners.add(prepared);
      if (warmed.prepared) prepared(warmed.prepared);
    }
    try {
      return {
        ...(await warmed.promise),
        id: track.id,
        inLibrary: track.inLibrary,
      };
    } finally {
      if (prepared) warmed.listeners.delete(prepared);
    }
  }
  const cached = await invoke<AudioFile | null>("extractor_cached", {
    recording: audioCacheIdentity(track),
    duration: track.duration,
    urls: [
      track.extractorUrl,
      track.src,
      ...(track.alternatives || []).map((item) => item.url),
    ].filter((url): url is string => !!url && !excluded.includes(url)),
  }).catch(() => null);
  if (cached?.path && !excluded.length) {
    playbackLog("cache-hit", track, {
      format: cached.format,
      size: cached.size,
    });
    if (cached.format !== "FLAC") void warmLossless(track);
    return {
      ...track,
      src: convertFileSrc(cached.path),
      format: cached.format,
      duration: cached.duration,
      nativeKey: cached.key,
      sampleRate: cached.sampleRate,
      bitDepth: cached.bitDepth,
      streamType: undefined,
    };
  }
  if (streaming || !track.extractorUrl) {
    const started = performance.now();
    try {
      const key = `${audioCacheIdentity(track)}:${Math.round(track.duration)}`;
      if (excluded.length) streamJobs.delete(key);
      const existing = !excluded.length ? streamJobs.get(key) : undefined;
      if (existing && Date.now() < existing.expires) {
        if (prepared) {
          existing.listeners.add(prepared);
          if (existing.prepared) prepared(existing.prepared);
        }
        try {
          const resolved = await existing.promise;
          playbackLog("stream-reuse", track);
          return { ...resolved, id: track.id, inLibrary: track.inLibrary };
        } finally {
          if (prepared) existing.listeners.delete(prepared);
        }
      }
      const listeners = new Set<(track: Track) => void>();
      if (prepared) listeners.add(prepared);
      const job: StreamJob = {
        expires: Date.now() + 180000,
        listeners,
        promise: resolveStreaming(track, excluded, (candidate) => {
          job.prepared = candidate;
          for (const listener of listeners) listener(candidate);
        }),
      };
      const promise = job.promise;
      if (!excluded.length) {
        if (streamJobs.size >= 32)
          streamJobs.delete(streamJobs.keys().next().value!);
        streamJobs.set(key, job);
        void promise.then(
          (value) => {
            if (value.nativeKey && streamJobs.get(key)?.promise === promise)
              streamJobs.delete(key);
          },
          () => {
            if (streamJobs.get(key)?.promise === promise)
              streamJobs.delete(key);
          },
        );
      }
      const resolved = await promise.finally(() => listeners.clear());
      playbackLog("resolve-ready", track, {
        elapsedMs: Math.round(performance.now() - started),
        format: resolved.format,
      });
      return resolved;
    } catch (error) {
      playbackLog("resolve-failed", track, {
        elapsedMs: Math.round(performance.now() - started),
        error,
      });
      throw error;
    }
  }
  const cacheKey = JSON.stringify([
    streaming,
    track.id,
    track.extractorUrl,
    track.alternatives,
  ]);
  let promise = pending.get(cacheKey);
  if (!promise) {
    promise = (async () => {
      const candidates = [
        ...new Map(
          [
            {
              url: track.extractorUrl!,
              duration: track.duration,
              quality: track.qualityHint,
            },
            ...(track.alternatives || []),
          ].map((c) => [c.url, c]),
        ).values(),
      ].sort(
        (a, b) =>
          Number(b.quality === "lossless") - Number(a.quality === "lossless") ||
          sourcePriority({ source: track.source, extractorUrl: a.url }) -
            sourcePriority({ source: track.source, extractorUrl: b.url }),
      );
      let best: AudioFile | undefined;
      let bestScore = -1;
      let failure = "Полная запись недоступна в подключённых источниках.";
      for (const candidate of candidates) {
        try {
          const file = await invoke<AudioFile>(
            streaming ? "extractor_stream" : "extractor_audio",
            {
              url: candidate.url,
              duration: candidate.duration,
              recording: audioCacheIdentity(track),
            },
          );
          const score =
            file.format === "Аудио" && candidate.quality === "lossless"
              ? 3.5
              : audioQuality(file.format);
          if (!best || score > bestScore) {
            best = file;
            bestScore = score;
          }
          if (file.format === "FLAC") break;
          if (
            candidate.quality !== "lossless" &&
            !candidates.some((c) => c.quality === "lossless")
          )
            break;
        } catch (error) {
          failure = String(error);
        }
      }
      if (!best) throw new Error(failure);
      return {
        ...track,
        src: best.url || convertFileSrc(best.path!),
        streamType: best.hls ? ("hls" as const) : undefined,
        duration: best.duration,
        format: best.format,
        sampleRate: best.sampleRate,
        bitDepth: best.bitDepth,
        nativeKey: best.format === "FLAC" ? best.key : undefined,
      };
    })().catch((error) => {
      pending.delete(cacheKey);
      throw error;
    });
    pending.set(cacheKey, promise);
    if (streaming)
      void promise.then(
        () => {
          window.setTimeout(() => pending.delete(cacheKey), 180000);
        },
        () => {},
      );
  }
  return { ...track, ...(await promise), inLibrary: track.inLibrary };
}

let lucidaCoverage: {
  service: string;
  error?: string;
  count: number;
}[] = [];
interface LucidaTrack {
  id: string | number;
  title: string;
  url: string;
  durationMs: number;
  artists?: { name: string }[];
  album?: { title: string; coverArtwork?: { url: string }[] };
  coverArtwork?: { url: string }[];
  service?: string;
  country?: string;
}
type LucidaSearch = {
  tracks: LucidaTrack[];
  catalogs?: { service: string; error?: string; count: number }[];
  service?: string;
};
const lucidaSearches = new Map<
  string,
  { expires: number; promise: Promise<LucidaSearch> }
>();
function cachedLucidaSearch(query: string, service: string, fast = false) {
  const key = JSON.stringify([
    query.normalize("NFKC").toLowerCase().trim(),
    service,
    fast,
  ]);
  const cached = lucidaSearches.get(key);
  if (cached && Date.now() < cached.expires) return cached.promise;
  const entry = {
    expires: Date.now() + 180000,
    promise: invoke<LucidaSearch>("lucida_search", { query, service, fast }),
  };
  lucidaSearches.set(key, entry);
  if (lucidaSearches.size > 64)
    lucidaSearches.delete(lucidaSearches.keys().next().value!);
  void entry.promise.then(
    (result) => {
      if (!Array.isArray(result.tracks)) {
        lucidaSearches.delete(key);
        return;
      }
      if (!result.tracks.length) entry.expires = Date.now() + 15000;
    },
    () => {
      if (lucidaSearches.get(key) === entry) lucidaSearches.delete(key);
    },
  );
  return entry.promise;
}
export async function searchLucida(
  query: string,
  service: "amazon" | "all" | "others" = "amazon",
): Promise<Track[]> {
  try {
    return await queryLucida(query, service);
  } catch (error) {
    if (service === "amazon") return queryLucida(query, "others");
    throw error;
  }
}
async function queryLucida(
  query: string,
  service: "amazon" | "all" | "others",
  fast = false,
): Promise<Track[]> {
  if (!("__TAURI_INTERNALS__" in window)) return [];
  const result = await cachedLucidaSearch(query, service, fast);
  if (!Array.isArray(result.tracks))
    throw new Error("Invalid Lucida search response");
  lucidaCoverage = result.catalogs || [];
  if (!fast && service === "amazon" && !result.tracks.length)
    return searchLucida(query, "others");
  return result.tracks.flatMap((item) => {
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      return [];
    }
    if (
      url.protocol !== "https:" ||
      ![
        "open.qobuz.com",
        "play.qobuz.com",
        "www.qobuz.com",
        "soundcloud.com",
        "tidal.com",
        "listen.tidal.com",
        "www.deezer.com",
        "deezer.com",
        "music.yandex.ru",
        "music.yandex.com",
        "music.amazon.com",
        "music.amazon.co.uk",
        "music.amazon.de",
        "music.amazon.fr",
        "music.amazon.ca",
        "music.amazon.co.jp",
        "music.amazon.it",
        "music.amazon.es",
      ].includes(url.hostname) ||
      item.durationMs <= 30000
    )
      return [];
    return [
      {
        id: `lucida:${item.service || result.service}:${item.id}`,
        title: item.title,
        artist: item.artists?.[0]?.name || "Неизвестный исполнитель",
        artists: item.artists?.map((artist) => artist.name),
        album: item.album?.title || item.title,
        duration: item.durationMs / 1000,
        cover:
          item.coverArtwork?.at(-1)?.url ||
          item.album?.coverArtwork?.at(-1)?.url ||
          "/covers/imported.svg",
        source: "Lucida" as const,
        qualityHint: ["qobuz", "tidal", "deezer", "amazon", "yandex"].includes(
          item.service || result.service || "",
        )
          ? ("lossless" as const)
          : ("lossy" as const),
        alternatives: [
          {
            url: url.href,
            service: item.service || result.service,
            duration: item.durationMs / 1000,
            quality: ["qobuz", "tidal", "deezer", "amazon", "yandex"].includes(
              item.service || result.service || "",
            )
              ? ("lossless" as const)
              : ("lossy" as const),
          },
        ],
        format: "Аудио",
        src: url.href,
        extractorUrl: url.href,
        attributionUrl: url.href,
        downloadAllowed: true,
      },
    ];
  });
}

function firstMatchingSources(wanted: Track, requests: Promise<Track[]>[]) {
  return new Promise<Track[]>((resolve) => {
    if (!requests.length) return resolve([]);
    const found: Track[] = [];
    let remaining = requests.length;
    for (const request of requests)
      void request
        .then(
          (tracks) => {
            found.push(...tracks);
            const matching = tracks.filter((candidate) =>
              sameRecording(wanted, candidate),
            );
            if (matching.length) resolve(matching);
          },
          () => {},
        )
        .finally(() => {
          if (--remaining === 0) resolve(found);
        });
  });
}

const lucidaUnavailableUntil = new Map<string, number>();
export interface OfflineSource {
  path?: string;
  url?: string;
  hls?: boolean;
  serviceUrl?: string;
}
export async function prepareOfflineSource(
  track: Track,
  skipCache = false,
): Promise<OfflineSource> {
  if (!("__TAURI_INTERNALS__" in window))
    throw new Error("Офлайн-загрузка доступна в приложении LOUD.");
  const cached = await invoke<AudioFile | null>("extractor_cached", {
    recording: audioCacheIdentity(track),
    duration: track.duration,
    urls: [track.extractorUrl, track.remoteUrl].filter(Boolean),
  });
  if (!skipCache && cached?.path) return { path: cached.path };
  if (!skipCache && track.offlinePath) return { path: track.offlinePath };
  if (track.remoteUrl && !track.extractorUrl) {
    if (track.downloadAllowed === false)
      throw new Error("Автор отключил скачивание этой записи.");
    return { url: track.remoteUrl };
  }
  const resolved = await resolveStreaming(track, [], undefined, true);
  if (resolved.playbackSource?.startsWith("https://www.youtube.com/watch?")) {
    const file = await invoke<AudioFile>("extractor_cache_stream", {
      url: resolved.streamCacheUrl || resolved.src,
      recording: audioCacheIdentity(track),
      duration: track.duration,
    });
    return { path: file.path };
  }
  return {
    url: resolved.streamCacheUrl || resolved.src,
    hls: !!resolved.streamType,
    serviceUrl: resolved.playbackSource || resolved.extractorUrl,
  };
}
async function resolveStreaming(
  track: Track,
  excluded: readonly string[],
  prepared?: (track: Track) => void,
  metadataOnly = false,
): Promise<Track> {
  if ((track.artists?.length || 0) < 2 && /^deezer:\d+$/.test(track.id)) {
    track = { ...track };
    void catalogJSON<{ contributors?: { name: string }[] }>(
      "deezer",
      `/track/${track.id.slice(7)}`,
    )
      .then((metadata) => {
        if (metadata.contributors?.length)
          track.artists = metadata.contributors.map((artist) => artist.name);
      })
      .catch(() => {});
  }
  const resolveCandidate = async (candidate: Track): Promise<Track> => {
    if (!candidate.extractorUrl)
      return { ...candidate, playbackSource: candidate.src };
    const direct = ["soundcloud.com", "www.youtube.com"].includes(
      new URL(candidate.extractorUrl).hostname,
    );
    const host = new URL(candidate.extractorUrl).hostname;
    const started = performance.now();
    playbackLog("source-start", track, {
      host,
      candidateDuration: candidate.duration,
    });
    if (!direct && Date.now() < (lucidaUnavailableUntil.get(host) || 0)) {
      playbackLog("source-cooldown", track, { host });
      throw new Error("Music service is temporarily unavailable");
    }
    let timer: ReturnType<typeof setTimeout>;
    try {
      const file = await Promise.race([
        invoke<AudioFile>("extractor_stream", {
          url: candidate.extractorUrl,
          duration: candidate.duration,
          recording: audioCacheIdentity(track),
          ...(direct ? { directOnly: true } : {}),
          ...(metadataOnly ? { prepareOnly: true } : {}),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Stream source timed out")),
            direct ? 20000 : 18000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      playbackLog("source-ready", track, {
        host,
        elapsedMs: Math.round(performance.now() - started),
        format: file.format,
        actualDuration: file.duration,
      });
      return {
        ...track,
        src: file.url || convertFileSrc(file.path!),
        format: file.format,
        duration: file.duration,
        streamType: file.hls ? ("hls" as const) : undefined,
        streamCacheUrl: file.cacheUrl,
        streamCacheKey: file.cacheKey,
        playbackSource: candidate.extractorUrl,
        nativeKey: file.key || undefined,
        sampleRate: file.sampleRate,
        bitDepth: file.bitDepth,
      };
    } catch (error) {
      playbackLog("source-failed", track, {
        host,
        elapsedMs: Math.round(performance.now() - started),
        error,
      });
      if (
        !direct &&
        /No servers available|HTTP (?:403|429|502|503)\b|timed out/i.test(
          String(error),
        )
      )
        lucidaUnavailableUntil.set(host, Date.now() + 15000);
      throw error;
    }
  };
  let finished = false;
  return chooseStream(
    {
      ...track,
      alternatives: [...(track.alternatives || []), ...savedSources(track)],
    },
    {
      resolve: resolveCandidate,
      metadataOnly,
      prepared: (resolved) => {
        try {
          rememberSource(track, resolved);
        } catch {}
        prepared?.(resolved);
      },
      warmPrimary: metadataOnly
        ? undefined
        : (candidate) => {
            void resolveCandidate(candidate).catch(() => {});
          },
      discoverPrimary: async (wanted) => {
        const started = performance.now();
        const artist = trackArtists(wanted)[0] || wanted.artist;
        const query = `${artist} ${wanted.title}`;
        const service = sourcePriority(wanted) === 0 ? "others" : "amazon";
        const first = await queryLucida(query, service, true).catch(() => []);
        const matching = first.filter((candidate) =>
          sameRecording(wanted, candidate),
        );
        playbackLog("primary-search", wanted, {
          elapsedMs: Math.round(performance.now() - started),
          count: first.length,
          matching: matching.length,
          catalogs: lucidaCoverage,
          fast: true,
        });
        if (matching.length) return matching;
        const requests = [queryLucida(wanted.title, service, true)];
        if (service === "amazon")
          requests.push(queryLucida(query, "others", true));
        return firstMatchingSources(wanted, requests);
      },
      discover: async (wanted) => {
        const queries = [
          ...new Set(
            trackArtists(wanted)
              .slice(0, 2)
              .map((artist) => `${artist} ${wanted.title}`),
          ),
        ];
        const jobs = [
          ...queries.map((query) => searchExtracted(query)),
          import("./search").then(({ searchAudius }) =>
            searchAudius(
              `${trackArtists(wanted)[0] || wanted.artist} ${wanted.title}`,
            ),
          ),
        ];
        jobs.push(
          new Promise<Track[]>((resolve) => {
            window.setTimeout(() => {
              if (finished) return resolve([]);
              void searchExtracted(
                `${trackArtists(wanted)[0] || wanted.artist} ${wanted.title}`,
                "youtube",
              ).then(resolve, () => resolve([]));
            }, 1200);
          }),
        );
        return firstMatchingSources(wanted, jobs);
      },
    },
    excluded,
  ).finally(() => {
    finished = true;
  });
}
