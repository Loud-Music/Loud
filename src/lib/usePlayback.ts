import {
  connectEqualizer,
  defaultEqualizer,
  normalizeEqualizer,
  type EqualizerSettings,
  type EqualizerGraph,
} from "./equalizer";
import type Hls from "hls.js";
import {
  cachePlayingStream,
  needsAudioResolution,
  resolveExtracted,
} from "./extractor";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktop, prepareExclusive } from "./catalog";
import { readSetting, saveSetting } from "./library";
import type { Track } from "./library";
import { GaplessSession, prepareGapless } from "./gapless";
import { playbackLog } from "./playbackLog";
import { setPlaybackProgress } from "./playbackProgress";

export interface OutputStatus {
  session: number;
  phase: string;
  key: string;
  position: number;
  duration: number;
  sampleRate: number;
  bits: number;
  channels: number;
  device: string;
  exclusive: boolean;
  error: string | null;
  level?: number;
  bass?: number;
}
const idle: OutputStatus = {
  session: 0,
  phase: "idle",
  key: "",
  position: 0,
  duration: 0,
  sampleRate: 0,
  bits: 0,
  channels: 0,
  device: "",
  exclusive: false,
  error: null,
};
export const exclusiveAvailable = () =>
  isDesktop() && /Windows/i.test(navigator.userAgent);
const analysePlayback = () =>
  !isDesktop() || !/Linux/i.test(navigator.userAgent);
const cancelledPlay = (error: unknown) =>
  (error instanceof Error || error instanceof DOMException) &&
  error.name === "AbortError";
const mediaPlaying = (element: HTMLAudioElement | null) =>
  !!element &&
  !element.paused &&
  !element.ended &&
  !element.error &&
  element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
export default function usePlayback(
  track: Track,
  notify: (message: string) => void,
  ended: RefObject<() => void>,
  nextTrack?: Track,
) {
  const audio = useRef<HTMLAudioElement>(null);
  const hls = useRef<Hls | undefined>(undefined);
  const recover = useRef<(() => void) | undefined>(undefined);
  const networkWaiting = useRef(false);
  const remotePlayback = useRef(false);
  const resumeNetwork = useRef<(() => void) | undefined>(undefined);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(track.duration);
  const [volume, setVolume] = useState<number>(() =>
    readSetting("volume", 0.65),
  );
  const [preferExclusive, setExclusiveState] = useState<boolean>(
    () => exclusiveAvailable() && readSetting("exclusiveOutput", false),
  );
  const [equalizer, setEqualizerState] = useState<EqualizerSettings>(() =>
    normalizeEqualizer(readSetting("equalizer:v1", defaultEqualizer())),
  );
  const eqGraph = useRef<EqualizerGraph | undefined>(undefined);
  const gaplessSession = useRef<GaplessSession | undefined>(undefined);
  const gaplessFailed = useRef(new Set<string>());
  const adoptedGapless = useRef("");
  const activeTrack = useRef(track);
  activeTrack.current = track;
  const [gapless, setGaplessState] = useState(() =>
    readSetting("gapless:v1", true),
  );
  const [gaplessEpoch, setGaplessEpoch] = useState(0);
  const [timelineOffset, setTimelineOffset] = useState(0);
  const setGapless = useCallback((enabled: boolean) => {
    setGaplessState(enabled);
    saveSetting("gapless:v1", enabled);
  }, []);
  const setEqualizer = useCallback((value: EqualizerSettings) => {
    const next = normalizeEqualizer(value);
    setEqualizerState(next);
    saveSetting("equalizer:v1", next);
    if (next.enabled) {
      setExclusiveState(false);
      saveSetting("exclusiveOutput", false);
    }
  }, []);
  const exclusive =
    preferExclusive &&
    !equalizer.enabled &&
    track.format === "FLAC" &&
    !track.preview;
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    if (
      !exclusive &&
      (equalizer.enabled || (playing && analysePlayback())) &&
      !eqGraph.current
    ) {
      try {
        eqGraph.current = connectEqualizer(element);
      } catch (error) {
        playbackLog("audio-analysis-unavailable", track, { error });
        if (equalizer.enabled) {
          notify("Не удалось включить эквалайзер.");
          setEqualizer({ ...equalizer, enabled: false });
        }
        return;
      }
    }
    eqGraph.current?.configure(equalizer);
    if (!exclusive && (playing || equalizer.enabled))
      void eqGraph.current?.context.resume().catch((error) =>
        playbackLog("audio-context-resume-failed", activeTrack.current, {
          error,
        }),
      );
  }, [equalizer, exclusive, playing, notify, setEqualizer]);
  useEffect(() => {
    const element = audio.current;
    return () => {
      setTimeout(() => {
        if (!element?.isConnected) void eqGraph.current?.context.close();
      }, 0);
    };
  }, []);
  const [output, setOutput] = useState<OutputStatus>(idle);
  const [preparing, setPreparing] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const isCurrent = useCallback(
    (token: number, song: Track) =>
      token === generation.current &&
      activeTrack.current.id === song.id &&
      activeTrack.current.src === song.src,
    [],
  );
  const dismissError = useCallback(() => setError(""), []);
  const desiredPlaying = useRef(playing);
  desiredPlaying.current = playing;
  const loadingAudio = useRef<Promise<Track> | undefined>(undefined);
  const [playbackFormat, setPlaybackFormat] = useState(track.format);
  const key = useRef("");
  const nativeSession = useRef(0);
  const finished = useRef(false);
  const startGapless = useCallback(
    async (song: Track, token: number, ready: () => void) => {
      if (
        !gapless ||
        exclusive ||
        song.streamType ||
        gaplessFailed.current.has(song.id) ||
        !isDesktop() ||
        typeof MediaSource === "undefined" ||
        !["FLAC", "AAC", "MP3"].includes(song.format || "")
      )
        return false;
      let resource;
      try {
        resource = await prepareGapless(song);
      } catch {
        return false;
      }
      if (token !== generation.current || !audio.current) {
        void invoke("gapless_release", { url: resource.url }).catch(() => {});
        return true;
      }
      const element = audio.current;
      const session = new GaplessSession(element, () => {
        if (gaplessSession.current !== session) return;
        const segment = session.active();
        const selected = segment?.track || song;
        const position = Math.max(
          0,
          element.currentTime - (segment?.offset || 0),
        );
        gaplessFailed.current.add(selected.id);
        session.close();
        gaplessSession.current = undefined;
        setTimelineOffset(0);
        element.addEventListener(
          "loadedmetadata",
          () => {
            element.currentTime = Math.min(
              position,
              Math.max(0, element.duration - 0.05),
            );
            if (desiredPlaying.current) void element.play().catch(() => {});
          },
          { once: true },
        );
        element.src = selected.src || "";
        element.load();
      });
      gaplessSession.current?.close();
      gaplessSession.current = session;
      setTimelineOffset(0);
      element.addEventListener("loadedmetadata", ready, { once: true });
      await session.start(song, resource);
      if (token === generation.current) setGaplessEpoch((value) => value + 1);
      return true;
    },
    [gapless, exclusive],
  );

  useEffect(() => {
    const session = gaplessSession.current;
    if (!session) return;
    if (!gapless || exclusive) {
      session.clearUpcoming();
      return;
    }
    if (!nextTrack || nextTrack.id === track.id) {
      session.clearUpcoming();
      return;
    }
    session.clearUpcoming();
    let active = true;
    void (async () => {
      const resolved = await resolveExtracted(nextTrack, true);
      const resource = await prepareGapless(resolved);
      if (!active || gaplessSession.current !== session) {
        void invoke("gapless_release", { url: resource.url }).catch(() => {});
        return;
      }
      session.enqueue(resolved, resource);
    })().catch((error) =>
      playbackLog("gapless-prefetch-failed", nextTrack, { error }),
    );
    return () => {
      active = false;
    };
  }, [nextTrack?.id, gaplessEpoch, gapless, exclusive, track.id]);

  useEffect(() => {
    if (!gaplessSession.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const session = gaplessSession.current;
      const segment = session?.active();
      if (
        segment &&
        segment.track.id !== activeTrack.current.id &&
        adoptedGapless.current !== segment.track.id
      ) {
        adoptedGapless.current = segment.track.id;
        setTimelineOffset(segment.offset);
        setPlaybackProgress(
          Math.max(0, (audio.current?.currentTime || 0) - segment.offset),
        );
        setDuration(segment.duration);
        setPlaybackFormat(segment.track.format);
        ended.current();
      }
      session?.finishIfNeeded();
      timer = setTimeout(tick, audio.current?.paused ? 250 : 50);
    };
    tick();
    return () => clearTimeout(timer);
  }, [gaplessEpoch, ended]);
  useEffect(() => {
    const offline = () => {
      if (!remotePlayback.current || !desiredPlaying.current) return;
      networkWaiting.current = true;
      clearTimeout(stallTimer.current);
    };
    const online = () => {
      if (!networkWaiting.current || !desiredPlaying.current) return;
      networkWaiting.current = false;
      const element = audio.current;
      if (
        element &&
        !element.paused &&
        element.readyState >= 3 &&
        !element.error
      ) {
        hls.current?.startLoad(-1);
        setBuffering(false);
      } else resumeNetwork.current?.();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);
  const startNative = useCallback(
    async (song: Track) => {
      const token = ++generation.current;
      key.current = "";
      finished.current = false;
      setPreparing(true);
      setError("");
      setOutput({ ...idle, phase: "loading" });
      audio.current?.pause();
      await invoke("exclusive_control", { action: "stop" }).catch(() => {});
      try {
        const prepared = await prepareExclusive(song);
        if (token !== generation.current) return;
        await invoke("audio_cache_pin", { key: prepared });
        const session = await invoke<number>("exclusive_play", {
          key: prepared,
          start: 0,
        });
        if (token !== generation.current) return;
        nativeSession.current = session;
        key.current = prepared;
        if (token === generation.current) setPlaying(true);
      } catch (error) {
        if (isCurrent(token, song)) {
          const message = String(
            error instanceof Error ? error.message : error,
          );
          setPlaying(false);
          setOutput({ ...idle, phase: "error", error: message });
          setError(message);
        }
      } finally {
        if (token === generation.current) setPreparing(false);
      }
    },
    [isCurrent],
  );
  useEffect(() => {
    saveSetting("volume", volume);
    if (audio.current) audio.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    setError("");
    const adopted = gaplessSession.current?.active();
    if (adoptedGapless.current === track.id && adopted?.track.id === track.id) {
      adoptedGapless.current = "";
      setTimelineOffset(adopted.offset);
      setDuration(adopted.duration);
      setPlaybackFormat(adopted.track.format);
      recover.current = undefined;
      if (isDesktop())
        void invoke("audio_cache_pin", {
          key: adopted.track.nativeKey || adopted.track.streamCacheKey || null,
        }).catch(() => {});
      return;
    }
    gaplessSession.current?.close();
    gaplessSession.current = undefined;
    setTimelineOffset(0);
    const token = ++generation.current;
    recover.current = undefined;
    clearTimeout(stallTimer.current);
    hls.current?.destroy();
    hls.current = undefined;
    loadingAudio.current = undefined;
    networkWaiting.current = false;
    resumeNetwork.current = undefined;
    remotePlayback.current =
      /^https?:/.test(track.src || "") &&
      !track.src?.startsWith("http://asset.localhost/");
    setPreparing(false);
    if (isDesktop())
      void invoke("audio_cache_pin", { key: track.nativeKey || null }).catch(
        () => {},
      );
    setPlaybackFormat(track.format);
    key.current = "";
    finished.current = false;
    el.pause();
    setPlaybackProgress(0);
    setDuration(track.duration);
    setOutput(idle);
    setBuffering(false);
    if (track.preview) {
      el.removeAttribute("src");
      el.load();
      if (isDesktop())
        void invoke("exclusive_control", { action: "stop" }).catch(() => {});
      setPlaying(false);
      return;
    }
    if (needsAudioResolution(track)) {
      el.removeAttribute("src");
      el.load();
      if (isDesktop())
        void invoke("exclusive_control", { action: "stop" }).catch(() => {});
      setPreparing(true);
      const failed: string[] = [];
      let selected = "",
        attempts = 0,
        switching = false;
      let sourceAttempt = 0;
      let removeReady = () => {};
      let resumePosition = 0;
      const load = async (): Promise<Track> => {
        if (switching) throw new Error("Stream is already switching");
        const request = ++sourceAttempt;
        const current = () =>
          isCurrent(token, track) && request === sourceAttempt;
        removeReady();
        switching = true;
        setPreparing(true);
        clearTimeout(stallTimer.current);
        try {
          const resolved = await resolveExtracted(
            track,
            true,
            failed,
            (candidate) => {
              if (
                !current() ||
                candidate.streamType ||
                !candidate.src ||
                candidate.format === "FLAC" ||
                !el.paused
              )
                return;
              if (el.getAttribute("src") !== candidate.src) {
                el.preload = "auto";
                el.src = candidate.src;
                el.load();
              }
            },
          );
          if (!current()) return resolved;
          if (isDesktop())
            void invoke("audio_cache_pin", {
              key: resolved.nativeKey || resolved.streamCacheKey || null,
            }).catch(() => {});
          if (!current()) return resolved;
          selected =
            resolved.playbackSource ||
            resolved.extractorUrl ||
            resolved.src ||
            "";
          switching = false;
          remotePlayback.current =
            !!resolved.streamType ||
            (/^https?:/.test(resolved.src || "") &&
              !resolved.src?.startsWith("http://asset.localhost/"));
          setPlaybackFormat(resolved.format);
          setDuration(resolved.duration);
          hls.current?.destroy();
          hls.current = undefined;
          const ready = () => {
            if (!current()) return;
            if (
              !gaplessSession.current &&
              Number.isFinite(el.duration) &&
              ((el.duration <= 30 && !track.fullRecording) ||
                Math.abs(el.duration - track.duration) > 3)
            ) {
              recover.current?.();
              return;
            }
            if (resumePosition > 0)
              el.currentTime = Math.min(
                resumePosition,
                resolved.duration - 0.1,
              );
            if (desiredPlaying.current)
              void el
                .play()
                .then(() => {
                  if (current()) cachePlayingStream(track, resolved);
                })
                .catch((error) => {
                  if (current() && !cancelledPlay(error) && !mediaPlaying(el))
                    recover.current?.();
                });
          };
          if (desiredPlaying.current)
            stallTimer.current = setTimeout(() => {
              if (current()) recover.current?.();
            }, 8000);
          if (await startGapless(resolved, token, ready)) return resolved;
          const HlsPlayer =
            resolved.streamType === "hls"
              ? (await import("hls.js")).default
              : undefined;
          if (!current()) return resolved;
          if (HlsPlayer?.isSupported()) {
            const player = new HlsPlayer({
              enableWorker: true,
              maxBufferLength: 20,
              maxMaxBufferLength: 30,
              backBufferLength: 15,
            });
            hls.current = player;
            player.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
              ready();
              if (!desiredPlaying.current) player.stopLoad();
            });
            player.on(HlsPlayer.Events.ERROR, (_, error) => {
              if (error.fatal && current() && hls.current === player)
                recover.current?.();
            });
            player.loadSource(resolved.src!);
            player.attachMedia(el);
          } else {
            const prepared = el.getAttribute("src") === resolved.src;
            if (prepared && el.readyState >= 1) ready();
            else {
              el.addEventListener("loadedmetadata", ready, { once: true });
              removeReady = () =>
                el.removeEventListener("loadedmetadata", ready);
              if (!prepared) {
                el.src = resolved.src!;
                el.load();
              }
            }
          }
          return resolved;
        } finally {
          if (current()) switching = false;
        }
      };
      const fail = (error: unknown) => {
        if (
          !isCurrent(token, track) ||
          cancelledPlay(error) ||
          mediaPlaying(el)
        )
          return;
        if (navigator.onLine === false) {
          networkWaiting.current = true;
          setPreparing(false);
          setBuffering(true);
          return;
        }
        recover.current = undefined;
        clearTimeout(stallTimer.current);
        setPreparing(false);
        setBuffering(false);
        setPlaying(false);
        setError(String(error instanceof Error ? error.message : error));
      };
      recover.current = () => {
        if (token !== generation.current || switching) return;
        clearTimeout(stallTimer.current);
        if (navigator.onLine === false) {
          networkWaiting.current = true;
          setBuffering(true);
          hls.current?.stopLoad();
          return;
        }
        if (selected && !failed.includes(selected)) failed.push(selected);
        resumePosition = Math.max(
          resumePosition,
          Number.isFinite(el.currentTime) ? el.currentTime : 0,
        );
        hls.current?.destroy();
        hls.current = undefined;
        el.pause();
        if (++attempts > 3) {
          fail(
            new Error("Полная запись сейчас недоступна в других источниках."),
          );
          return;
        }
        const retry = load();
        loadingAudio.current = retry;
        void retry.catch(fail);
      };
      resumeNetwork.current = () => {
        if (token !== generation.current || switching) return;
        resumePosition = Math.max(
          resumePosition,
          Number.isFinite(el.currentTime) ? el.currentTime : 0,
        );
        const retry = load();
        loadingAudio.current = retry;
        void retry.catch(fail);
      };
      const pending = load();
      loadingAudio.current = pending;
      void pending.catch(fail);
      return () => {
        removeReady();
        sourceAttempt++;
      };
    }
    if (exclusive) {
      el.removeAttribute("src");
      el.load();
      void invoke("exclusive_control", { action: "stop" }).catch(() => {});
      if (playing) void startNative(track);
    } else {
      if (isDesktop())
        void invoke("exclusive_control", { action: "stop" }).catch(() => {});
      resumeNetwork.current = () => {
        if (token !== generation.current) return;
        const position = Number.isFinite(el.currentTime) ? el.currentTime : 0;
        el.addEventListener(
          "loadedmetadata",
          () => {
            if (token !== generation.current) return;
            el.currentTime = Math.min(position, Math.max(0, el.duration - 0.1));
            if (desiredPlaying.current)
              void el.play().catch(() => recover.current?.());
          },
          { once: true },
        );
        el.load();
      };
      void (async () => {
        if (
          await startGapless(track, token, () => {
            if (desiredPlaying.current) void el.play().catch(() => {});
          })
        )
          return;
        if (token !== generation.current) return;
        el.src = track.src || "";
        el.load();
        if (desiredPlaying.current && track.src) await el.play();
      })().catch((error) => {
        if (
          !isCurrent(token, track) ||
          cancelledPlay(error) ||
          mediaPlaying(el)
        )
          return;
        setBuffering(false);
        setPlaying(false);
        setError(
          "Не удалось воспроизвести аудио. Проверьте подключение или выберите другой файл.",
        );
      });
    }
  }, [track.id, track.src, exclusive, isCurrent]);
  useEffect(() => {
    if (!exclusive) return;
    let active = true,
      busy = false;
    const poll = async () => {
      if (busy || !key.current) return;
      const token = generation.current;
      busy = true;
      try {
        const status = await invoke<OutputStatus>("exclusive_status");
        if (
          !active ||
          status.key !== key.current ||
          status.session !== nativeSession.current
        )
          return;
        setOutput(status);
        setPlaybackProgress(status.position);
        if (status.duration) setDuration(status.duration);
        if (status.phase === "playing") {
          setPlaying(true);
          setError("");
        }
        if (["paused", "error", "idle", "ended"].includes(status.phase))
          setPlaying(false);
        if (status.phase === "error" && !finished.current) {
          finished.current = true;
          setError(status.error || "Ошибка эксклюзивного вывода звука.");
        }
        if (status.phase === "ended" && !finished.current) {
          finished.current = true;
          ended.current();
        }
      } catch (error) {
        if (active && token === generation.current) {
          setError(String(error));
          setPlaying(false);
          key.current = "";
        }
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 250);
    void poll();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [exclusive, notify, ended]);
  useEffect(
    () => () => {
      ++generation.current;
      gaplessSession.current?.close();
      recover.current = undefined;
      clearTimeout(stallTimer.current);
      hls.current?.destroy();
      if (isDesktop())
        void invoke("exclusive_control", { action: "stop" }).catch(() => {});
    },
    [],
  );
  const play = useCallback(async () => {
    const token = generation.current;
    if (!isCurrent(token, track)) return;
    setError("");
    if (eqGraph.current?.context.state === "suspended")
      await eqGraph.current.context.resume();
    if (!isCurrent(token, track)) return;
    if (track.preview) {
      notify("Доступен только отрывок. Добавьте полный аудиофайл этой песни.");
      return;
    }
    if (needsAudioResolution(track) && loadingAudio.current) {
      const pending = loadingAudio.current;
      try {
        await pending;
        if (!isCurrent(token, track) || loadingAudio.current !== pending)
          return;
        hls.current?.startLoad(-1);
        await audio.current?.play();
        if (isCurrent(token, track)) setPlaying(true);
      } catch (error) {
        if (
          !isCurrent(token, track) ||
          loadingAudio.current !== pending ||
          cancelledPlay(error) ||
          mediaPlaying(audio.current)
        )
          return;
        setPlaying(false);
        setError(String(error instanceof Error ? error.message : error));
      }
      return;
    }
    if (exclusive) {
      if (output.phase === "paused" && key.current) {
        await invoke("exclusive_control", { action: "resume" });
        setPlaying(true);
      } else await startNative(track);
      return;
    }
    if (!audio.current || !track.src) return;
    try {
      await audio.current.play();
      if (isCurrent(token, track)) setPlaying(true);
    } catch (error) {
      if (
        !isCurrent(token, track) ||
        cancelledPlay(error) ||
        mediaPlaying(audio.current)
      )
        return;
      setPlaying(false);
      setError(
        "Не удалось начать воспроизведение. Проверьте подключение и формат аудио.",
      );
    }
  }, [exclusive, output.phase, track, startNative, notify, isCurrent]);
  const pause = useCallback(async () => {
    networkWaiting.current = false;
    setBuffering(false);
    clearTimeout(stallTimer.current);
    if (exclusive) {
      if (preparing) {
        ++generation.current;
        setPreparing(false);
        key.current = "";
      }
      await invoke("exclusive_control", { action: "pause" });
    } else {
      hls.current?.stopLoad();
      audio.current?.pause();
    }
    setPlaying(false);
  }, [exclusive, preparing]);
  const seek = useCallback(
    (position: number) => {
      if (!Number.isFinite(position)) return;
      if (exclusive) {
        if (!key.current) return;
        void invoke("exclusive_control", { action: "seek", position }).catch(
          (error) => notify(String(error)),
        );
      } else {
        if (!audio.current || !Number.isFinite(audio.current.duration)) return;
        audio.current.currentTime =
          position + (gaplessSession.current?.active()?.offset || 0);
      }
      setPlaybackProgress(position);
    },
    [exclusive, notify],
  );
  const togglePlay = useCallback(() => {
    const token = generation.current;
    void (
      playing || (preparing && desiredPlaying.current) ? pause() : play()
    ).catch((error) => {
      if (
        isCurrent(token, track) &&
        !cancelledPlay(error) &&
        !mediaPlaying(audio.current)
      )
        setError(String(error instanceof Error ? error.message : error));
    });
  }, [playing, preparing, pause, play, track, isCurrent]);
  const setExclusive = useCallback((value: boolean) => {
    ++generation.current;
    key.current = "";
    audio.current?.pause();
    setPlaying(false);
    setPreparing(false);
    setPlaybackProgress(0);
    setOutput(idle);
    if (isDesktop())
      void invoke("exclusive_control", { action: "stop" }).catch(() => {});
    if (value) {
      setEqualizerState((old) => {
        const next = { ...old, enabled: false };
        saveSetting("equalizer:v1", next);
        return next;
      });
    }
    setExclusiveState(value && exclusiveAvailable());
    saveSetting("exclusiveOutput", value && exclusiveAvailable());
  }, []);
  const audioProps = {
    crossOrigin: "anonymous" as const,
    onWaiting: () => {
      if (!exclusive && !audio.current?.paused) {
        setBuffering(true);
        if (recover.current) {
          clearTimeout(stallTimer.current);
          stallTimer.current = setTimeout(() => recover.current?.(), 8000);
        }
      }
    },
    onPlaying: () => {
      if (!mediaPlaying(audio.current)) return;
      setError("");
      if (eqGraph.current?.context.state === "suspended")
        void eqGraph.current.context.resume().catch((error) =>
          playbackLog("audio-context-resume-failed", activeTrack.current, {
            error,
          }),
        );
      playbackLog("audio-playing", activeTrack.current, {
        route: eqGraph.current ? "web-audio" : "media-element",
        context: eqGraph.current?.context.state,
        volume: audio.current?.volume,
        muted: audio.current?.muted,
        readyState: audio.current?.readyState,
        platform: navigator.platform,
      });
      clearTimeout(stallTimer.current);
      if (!exclusive) {
        setPreparing(false);
        setBuffering(false);
        setPlaying(true);
      }
    },
    onCanPlay: () => {
      if (!exclusive) setBuffering(false);
    },
    onLoadedMetadata: () => {
      if (gaplessSession.current) return;
      if (
        needsAudioResolution(track) &&
        audio.current &&
        ((audio.current.duration <= 30 && !track.fullRecording) ||
          Math.abs(audio.current.duration - track.duration) > 3)
      ) {
        recover.current?.();
        return;
      }
      if (
        !exclusive &&
        audio.current &&
        Number.isFinite(audio.current.duration)
      )
        setDuration(audio.current.duration);
    },
    onTimeUpdate: () => {
      if (!exclusive) {
        const segment = gaplessSession.current?.active();
        setPlaybackProgress(
          Math.max(
            0,
            (audio.current?.currentTime || 0) - (segment?.offset || 0),
          ),
        );
        if (segment?.complete) setDuration(segment.duration);
      }
    },
    onEnded: () => {
      if (!exclusive) {
        setPlaying(false);
        ended.current();
      }
    },
    onError: () => {
      if (!audio.current?.error || mediaPlaying(audio.current)) return;
      playbackLog("audio-element-error", activeTrack.current, {
        code: audio.current?.error?.code,
        error: audio.current?.error?.message,
        readyState: audio.current?.readyState,
        networkState: audio.current?.networkState,
      });
      if (remotePlayback.current && navigator.onLine === false) {
        networkWaiting.current = true;
        clearTimeout(stallTimer.current);
        setBuffering(true);
        return;
      }
      if (recover.current) {
        recover.current();
        return;
      }
      setBuffering(false);
      if (!exclusive && audio.current?.getAttribute("src")) {
        setPlaying(false);
        setError(
          "Не удалось загрузить аудио. Проверьте подключение или попробуйте другой формат.",
        );
      }
    },
  };
  return {
    audio,
    audioGraph: eqGraph,
    audioProps,
    playbackFormat,
    playing,
    setPlaying,
    duration,
    volume,
    setVolume,
    exclusive,
    preferExclusive,
    equalizer,
    gapless,
    setGapless,
    timelineOffset,
    setEqualizer,
    setExclusive,
    output,
    error,
    dismissError,
    loading: preparing || buffering || output.phase === "loading",
    play,
    pause,
    seek,
    togglePlay,
  };
}
