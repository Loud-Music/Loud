import { Button } from "@animate-ui/react/primitives/buttons/button";
import { blur, useMotionTokens } from "@animate-ui/react/utils/motion";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  memo,
  type RefObject,
  type CSSProperties,
} from "react";
import { Spinner, Refresh, X } from "../icons";
import type { Track } from "../lib/library";
import {
  loadLyrics,
  loadKaraoke,
  parseLyrics,
  separateLyricVoices,
} from "../lib/lyrics";
import { clearCatalogCache } from "../lib/catalogRequest";
import { clearLyricsCache, readyLyrics } from "../lib/lyricsCache";
import type { LyricLine, Lyrics } from "../lib/lyrics";
import { usePlaybackProgress } from "../lib/playbackProgress";
import WaveShader from "./WaveShader";
import type { EqualizerGraph } from "../lib/equalizer";

const LyricRow = memo(function LyricRow({
  line,
  current,
  past,
  near,
  distance,
  end,
  playing,
  clock,
  onSeek,
}: {
  line: LyricLine;
  current: boolean;
  past: boolean;
  near: boolean;
  distance: number;
  end: number;
  playing: boolean;
  clock: number;
  onSeek: (time: number) => void;
}) {
  const words = useMemo(() => {
    let space = true;
    return line.words?.flatMap((word) => {
      let text = word.text.replace(/\s+/g, " ");
      if (space) text = text.trimStart();
      if (!text) return [];
      space = /\s$/.test(text);
      return [{ ...word, text }];
    });
  }, [line.words]);
  return (
    <Button
      aria-label={line.text}
      aria-current={current && !line.secondary ? "true" : undefined}
      className={`${current ? "active" : past ? "past" : ""} ${near ? "near" : ""} ${line.secondary ? "secondary" : ""}`}
      style={
        { "--line-blur": `${Math.min(distance * 1.3, 6)}px` } as CSSProperties
      }
      onClick={() => onSeek(line.time)}
    >
      <span className="lyric-motion">
        <span className="lyric-content">
          {words?.length
            ? words.map((word, index) => {
                const wordEnd = word.end ?? words[index + 1]?.time ?? end;
                const duration = Math.max(0.08, wordEnd - word.time);
                const fill = Math.max(
                  0,
                  Math.min(1, (clock - word.time) / duration),
                );
                const singing =
                  playing && current && clock >= word.time && clock < wordEnd;
                const glow = singing
                  ? Math.pow(Math.sin(Math.PI * fill), 2)
                  : 0;
                return (
                  <span
                    key={index}
                    className={`lyric-word ${singing ? "is-singing" : ""}`}
                    data-text={word.text}
                    style={
                      {
                        "--word-progress": `${fill * 100}%`,
                        "--word-glow": glow * 0.65,
                        "--word-blur": fill > 0 ? "0px" : "0.6px",
                        "--word-lift": `${-glow * (duration > 0.45 ? 4 : 2)}px`,
                      } as CSSProperties
                    }
                  >
                    {word.text}
                  </span>
                );
              })
            : line.text}
        </span>
      </span>
    </Button>
  );
});

export default function LyricsPanel({
  track,
  timelineOffset = 0,
  audio,
  playing,
  audioGraph,
  effectsEnabled = true,
  exclusive = false,
  nativeLevel = 0,
  nativeBass = 0,
  artworkRef,
  seek,
  close,
}: {
  track: Track;
  timelineOffset?: number;
  audio?: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  audioGraph?: RefObject<EqualizerGraph | undefined>;
  effectsEnabled?: boolean;
  exclusive?: boolean;
  nativeLevel?: number;
  nativeBass?: number;
  artworkRef?: RefObject<HTMLImageElement | null>;
  seek: (time: number) => void;
  close: () => void;
}) {
  const present = useIsPresent();
  const reduced = useReducedMotion() || !effectsEnabled;
  const { transition } = useMotionTokens();
  const silentGraph = useRef<EqualizerGraph | undefined>(undefined);
  const progress = usePlaybackProgress();
  const [result, setResult] = useState<Lyrics | undefined>(() =>
    readyLyrics(track),
  );
  const [loading, setLoading] = useState(false);
  const [wordLoading, setWordLoading] = useState(false);
  const [error, setError] = useState("");
  const [wordError, setWordError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("loud-lyrics-configured", refresh);
    return () => window.removeEventListener("loud-lyrics-configured", refresh);
  }, []);
  const scroll = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (document.activeElement === document.body ||
          document.activeElement?.closest(".lyrics-panel"))
      )
        previous.focus();
    };
  }, []);
  const lines = useMemo(
    () =>
      separateLyricVoices(
        result?.lines ||
          (result?.syncedLyrics ? parseLyrics(result.syncedLyrics) : []),
      ),
    [result],
  );
  const [clock, setClock] = useState(progress);
  const position = useRef({ progress, at: performance.now() });
  const jumped = useRef(false);
  const manualScrollUntil = useRef(0);
  const [followRevision, setFollowRevision] = useState(0);
  const resumeScroll = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const stopScroll = useRef<(() => void) | undefined>(undefined);
  const lineAnimations = useRef<Animation[]>([]);
  const layoutTrack = useRef(track.id);
  useEffect(
    () => () => {
      lineAnimations.current.forEach((animation) => animation.cancel());
    },
    [],
  );
  const pauseFollow = () => {
    stopScroll.current?.();
    manualScrollUntil.current = performance.now() + 3000;
    clearTimeout(resumeScroll.current);
    resumeScroll.current = setTimeout(
      () => setFollowRevision((value) => value + 1),
      3000,
    );
  };
  useEffect(() => () => clearTimeout(resumeScroll.current), []);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setFollowRevision((value) => value + 1);
    reduced.addEventListener("change", update);
    return () => reduced.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const element = audio?.current;
    if (!element) return;
    const update = () => {
      const progress = Math.max(0, element.currentTime - timelineOffset);
      jumped.current = true;
      manualScrollUntil.current = 0;
      position.current = { progress, at: performance.now() };
      setClock(progress);
    };
    element.addEventListener("seeking", update);
    element.addEventListener("seeked", update);
    return () => {
      element.removeEventListener("seeking", update);
      element.removeEventListener("seeked", update);
    };
  }, [audio, timelineOffset]);
  useEffect(() => {
    const now = performance.now();
    const previous = position.current;
    const expected = playing ? (now - previous.at) / 1000 : 0;
    if (Math.abs(progress - previous.progress - expected) > 0.9) {
      jumped.current = true;
      manualScrollUntil.current = 0;
    }
    position.current = { progress, at: now };
    if (!playing) setClock(progress);
  }, [progress, playing]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      frame = requestAnimationFrame(tick);
      if (now - last < 1000 / 30) return;
      last = now;
      const element = audio?.current;
      const anchor = position.current;
      setClock(
        element && element.readyState >= 2
          ? Math.max(0, element.currentTime - timelineOffset)
          : anchor.progress +
              Math.min((performance.now() - anchor.at) / 1000, 0.35),
      );
    };
    const wake = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      if (!document.hidden) frame = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", wake);
    wake();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [playing, audio, track.id, timelineOffset]);
  const jump = useCallback(
    (time: number) => {
      jumped.current = true;
      manualScrollUntil.current = 0;
      setClock(time);
      seek(time);
    },
    [seek],
  );
  let active = -1;
  for (let i = 0; i < lines.length; i++)
    if (!lines[i].secondary && lines[i].time <= clock) active = i;
  useEffect(() => {
    let live = true;
    const cached = readyLyrics(track);
    setResult(cached);
    setError("");
    setWordError("");
    setWordLoading(false);
    if (!track.id) {
      setLoading(false);
      return;
    }
    setLoading(!cached);
    setWordLoading(!cached?.lines?.some((line) => line.words?.length));
    let found = !!cached?.lines?.some((line) => line.words?.length);
    const wordRequest = loadKaraoke(track).then((value) => {
      if (live && value) {
        found = true;
        setResult(value);
        setError("");
        setLoading(false);
      }
    });
    void loadLyrics(track)
      .then((value) => {
        if (live && !found) setResult(value);
      })
      .catch(() => {
        if (live && !found)
          setError("Не удалось загрузить текст. Проверьте соединение.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    void wordRequest
      .catch(() => {
        if (live) setWordError("Пословный текст временно недоступен.");
      })
      .finally(() => {
        if (live) setWordLoading(false);
      });
    return () => {
      live = false;
    };
  }, [track.id, track.title, track.artist, track.duration, revision]);
  useEffect(() => {
    const box = scroll.current;
    const line = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!box || !line || performance.now() < manualScrollUntil.current) return;
    const rows = [...box.querySelectorAll<HTMLElement>(".lyric-motion")];
    const previous = rows.map((row) => row.getBoundingClientRect().top);
    lineAnimations.current.forEach((animation) => animation.cancel());
    lineAnimations.current = [];
    stopScroll.current = undefined;
    const target = Math.max(
      0,
      Math.min(
        box.scrollHeight - box.clientHeight,
        line.offsetTop - box.clientHeight * 0.35,
      ),
    );
    const snap =
      jumped.current ||
      layoutTrack.current !== track.id ||
      !effectsEnabled ||
      document.documentElement.dataset.performance === "potato" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    layoutTrack.current = track.id;
    jumped.current = false;
    box.scrollTo({ top: target, behavior: "instant" });
    if (snap) return;
    const bounds = box.getBoundingClientRect();
    rows.forEach((row, index) => {
      const rect = row.getBoundingClientRect();
      const offset = previous[index] - rect.top;
      const outsideBefore =
        previous[index] > bounds.bottom ||
        previous[index] + rect.height < bounds.top;
      const outsideAfter = rect.top > bounds.bottom || rect.bottom < bounds.top;
      if (Math.abs(offset) < 0.5 || (outsideBefore && outsideAfter)) return;
      const animation = row.animate(
        [
          { transform: `translateY(${offset}px)` },
          { transform: "translateY(0)" },
        ],
        {
          duration: 1150,
          delay: Math.min(Math.abs(index - active) * 35, 180),
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
        },
      );
      animation.onfinish = () => animation.cancel();
      lineAnimations.current.push(animation);
    });
    stopScroll.current = () => {
      const content = line.querySelector<HTMLElement>(".lyric-motion");
      const before = content?.getBoundingClientRect().top;
      lineAnimations.current.forEach((animation) => animation.cancel());
      lineAnimations.current = [];
      if (content && before !== undefined)
        box.scrollTop += content.getBoundingClientRect().top - before;
    };
  }, [active, track.id, lines, followRevision, effectsEnabled]);
  useEffect(() => {
    const box = scroll.current;
    if (!box) return;
    const observer = new ResizeObserver(() =>
      setFollowRevision((value) => value + 1),
    );
    observer.observe(box);
    const content = box.querySelector(".lyrics-lines");
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [lines]);
  const retry = async () => {
    await clearLyricsCache(track);
    clearCatalogCache([
      "lyricsplus",
      "betterlyrics",
      "lrclib",
      "amll",
      "lrcmux",
      "rmmrevival",
      "itunes",
    ]);
    setRevision((v) => v + 1);
  };
  const hasWords = lines.some((line) => line.words?.length);
  return (
    <motion.section
      className="lyrics-panel"
      aria-label="Текст песни"
      aria-hidden={!present}
      inert={!present}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: transition.fade }}
      exit={{ opacity: 0, transition: transition.fade }}
    >
      <WaveShader
        variant="lyrics"
        enabled={effectsEnabled}
        audioGraph={audioGraph || silentGraph}
        playing={playing}
        exclusive={exclusive}
        nativeLevel={nativeLevel}
        nativeBass={nativeBass}
        cover={track.cover}
      />
      <header>
        <div>
          <h2>Текст песни</h2>
        </div>
        {!hasWords &&
          !wordLoading &&
          !loading &&
          (wordError || error || lines.length > 0) && (
            <Button
              className="icon-button"
              aria-label="Повторить загрузку текста"
              onClick={() => void retry()}
            >
              <Refresh size={16} />
            </Button>
          )}
        <Button
          ref={closeButton}
          className="icon-button"
          aria-label="Закрыть текст песни"
          onClick={close}
        >
          <X size={19} />
        </Button>
      </header>
      <motion.div
        className="lyrics-stage"
        initial={{ opacity: 0, filter: reduced ? "none" : blur.panel }}
        animate={{
          opacity: 1,
          filter: reduced ? "none" : "blur(0px)",
          transition: transition.panelIn,
        }}
        exit={{
          opacity: 0,
          filter: reduced ? "none" : blur.panel,
          transition: transition.panelOut,
        }}
      >
        <div className="lyrics-recording">
          <img
            ref={artworkRef}
            key={track.cover}
            src={track.cover}
            alt={track.id ? `Обложка ${track.album || track.title}` : "LOUD"}
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = "/covers/imported.svg";
            }}
          />
          <div>
            <h3>{track.title}</h3>
            <p>{track.artist || "Выберите песню в медиатеке"}</p>
          </div>
        </div>
        <div
          className="lyrics-scroll"
          ref={scroll}
          onWheel={pauseFollow}
          onTouchMove={pauseFollow}
          onKeyDown={(event) => {
            if (
              [
                "ArrowUp",
                "ArrowDown",
                "PageUp",
                "PageDown",
                "Home",
                "End",
              ].includes(event.key)
            )
              pauseFollow();
          }}
        >
          {loading || (!result && wordLoading) ? (
            <div className="lyrics-empty">
              <Spinner className="spin" size={24} />
              <p>Загружаем текст…</p>
            </div>
          ) : error && !wordLoading ? (
            <div className="lyrics-empty">
              <p role="alert">{error}</p>
              <Button className="button" onClick={retry}>
                <Refresh size={16} /> Повторить
              </Button>
            </div>
          ) : result?.instrumental ? (
            <div className="lyrics-empty">
              <p>Инструментальная композиция</p>
            </div>
          ) : lines.length ? (
            <div className="lyrics-lines">
              {lines.map((line, i) => {
                const end =
                  line.end ??
                  line.words?.at(-1)?.end ??
                  lines[i + 1]?.time ??
                  track.duration;
                const time =
                  clock < line.time
                    ? -Infinity
                    : clock > end
                      ? Infinity
                      : clock;
                const current =
                  i === active ||
                  !!(line.secondary && clock >= line.time && clock < end);
                return (
                  <LyricRow
                    key={`${line.time}:${i}`}
                    line={line}
                    current={current}
                    past={i < active || !!(line.secondary && clock >= end)}
                    near={Math.abs(i - active) <= 1}
                    distance={Math.abs(i - active)}
                    end={end}
                    playing={playing && current}
                    clock={time}
                    onSeek={jump}
                  />
                );
              })}
            </div>
          ) : result?.plainLyrics ? (
            <p className="lyrics-plain">{result.plainLyrics}</p>
          ) : (
            <div className="lyrics-empty">
              <p>
                {track.id
                  ? "Текст этой песни пока не найден."
                  : "Включите трек, чтобы увидеть текст."}
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.section>
  );
}
