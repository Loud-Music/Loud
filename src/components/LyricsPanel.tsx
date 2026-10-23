import { Button } from "@animate-ui/react/primitives/buttons/button";
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
import { loadLyrics, loadKaraoke, parseLyrics } from "../lib/lyrics";
import { clearCatalogCache } from "../lib/catalogRequest";
import { clearLyricsCache, readyLyrics } from "../lib/lyricsCache";
import type { LyricLine, Lyrics } from "../lib/lyrics";

const LyricRow = memo(function LyricRow({
  line,
  current,
  past,
  near,
  playing,
  clock,
  onSeek,
}: {
  line: LyricLine;
  current: boolean;
  past: boolean;
  near: boolean;
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
      aria-current={current ? "true" : undefined}
      className={`${current ? "active" : past ? "past" : ""} ${near ? "near" : ""}`}
      onClick={() => onSeek(line.time)}
    >
      {words?.length
        ? words.map((word, index) => {
            const fill = Math.max(
              0,
              Math.min(
                1,
                word.end && word.end > word.time
                  ? (clock - word.time) / (word.end - word.time)
                  : Number(clock >= word.time),
              ),
            );
            const glow =
              playing && current && fill > 0 && fill < 1
                ? Math.pow(Math.sin(Math.PI * fill), 2)
                : 0;
            return (
              <span
                key={index}
                className={`lyric-word ${playing && current && fill > 0 && fill < 1 ? "is-singing" : ""}`}
                data-text={word.text}
                style={
                  {
                    "--word-progress": `${fill * 100}%`,
                    "--word-start": `${fill <= 0 ? 0 : fill >= 1 ? 100 : Math.max(0, fill * 100 - 8)}%`,
                    "--word-end": `${fill <= 0 ? 0 : fill >= 1 ? 100 : Math.min(100, fill * 100 + 8)}%`,
                    "--word-glow": glow * 0.32,
                    "--word-lift": `${-1.4 * glow}px`,
                    "--word-scale": 1 + glow * 0.018,
                  } as CSSProperties
                }
              >
                {word.text}
              </span>
            );
          })
        : line.text}
    </Button>
  );
});

export default function LyricsPanel({
  track,
  progress,
  timelineOffset = 0,
  audio,
  playing,
  seek,
  close,
}: {
  track: Track;
  progress: number;
  timelineOffset?: number;
  audio?: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  seek: (time: number) => void;
  close: () => void;
}) {
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
      result?.lines ||
      (result?.syncedLyrics ? parseLyrics(result.syncedLyrics) : []),
    [result],
  );
  const [clock, setClock] = useState(progress);
  const position = useRef({ progress, at: performance.now() });
  const jumped = useRef(false);
  const manualScrollUntil = useRef(0);
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
  for (let i = 0; i < lines.length; i++) if (lines[i].time <= clock) active = i;
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
    const target = Math.max(
      0,
      Math.min(
        box.scrollHeight - box.clientHeight,
        line.offsetTop - box.clientHeight * 0.35,
      ),
    );
    if (
      jumped.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      jumped.current = false;
      box.scrollTo({ top: target, behavior: "instant" });
      return;
    }
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      if (now < manualScrollUntil.current) return;
      const remaining = target - box.scrollTop;
      box.scrollTop +=
        remaining * (1 - Math.exp(-Math.min(40, now - previous) / 170));
      previous = now;
      if (Math.abs(remaining) > 0.8) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, track.id, lines]);
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
    <section
      className="lyrics-panel"
      aria-label="Текст песни"
      style={
        {
          "--lyrics-art": `url(${JSON.stringify(track.cover)})`,
        } as CSSProperties
      }
    >
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
      <div className="lyrics-stage">
        <div className="lyrics-recording">
          <img
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
          onWheel={() => {
            manualScrollUntil.current = performance.now() + 3000;
          }}
          onTouchMove={() => {
            manualScrollUntil.current = performance.now() + 3000;
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
                return (
                  <LyricRow
                    key={`${line.time}:${i}`}
                    line={line}
                    current={i === active}
                    past={i < active}
                    near={Math.abs(i - active) <= 1}
                    playing={playing && i === active}
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
      </div>
    </section>
  );
}
