import { Collapsible } from "@animate-ui/react/primitives/radix-ui/collapsible";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { trackArtists } from "../lib/library";
import { useState } from "react";
import type { RefObject } from "react";
import type { EqualizerGraph } from "../lib/equalizer";
import WaveShader from "./WaveShader";
import {
  Check,
  Heart,
  Spinner,
  Play,
  Pause,
  Settings,
  SkipForward,
  ThumbsDown,
} from "../icons";
import { genreLabel, tasteGenres } from "../lib/recommendations";
import type { TasteProfile } from "../lib/recommendations";
import type { Track } from "../lib/library";
export default function Wave({
  profile,
  onChange,
  onStart,
  onSkip,
  onLike,
  onDislike,
  current,
  active,
  playing,
  loading,
  error,
  recommendations,
  liked,
  onPlay,
  audioGraph,
  exclusive,
  nativeLevel,
  nativeBass,
}: {
  profile: TasteProfile;
  onChange: (patch: Partial<TasteProfile>) => void;
  onStart: () => void;
  onSkip: () => void;
  onLike: () => void;
  onDislike: () => void;
  current: Track;
  active: boolean;
  playing: boolean;
  loading: boolean;
  error: string;
  recommendations: Track[];
  liked: boolean;
  onPlay: (track: Track) => void;
  audioGraph: RefObject<EqualizerGraph | undefined>;
  exclusive: boolean;
  nativeLevel: number;
  nativeBass: number;
}) {
  const [settings, setSettings] = useState(false);
  return (
    <Collapsible.Root asChild open={settings} onOpenChange={setSettings}>
      <section className="wave-view">
        <WaveShader
          audioGraph={audioGraph}
          playing={playing}
          exclusive={exclusive}
          nativeLevel={nativeLevel}
          nativeBass={nativeBass}
          cover={current.id ? current.cover : ""}
        />
        <div
          className={`wave-hero ${active && playing ? "wave-is-playing" : ""}`}
        >
          <div className="wave-hero-center">
            <Button
              className="wave-start"
              disabled={loading && !active}
              onClick={onStart}
              aria-label={
                active && playing ? "Приостановить волну" : "Включить мою волну"
              }
            >
              {loading && !active ? (
                <Spinner className="spin" size={27} />
              ) : active && playing ? (
                <Pause size={27} fill="currentColor" />
              ) : (
                <Play size={27} fill="currentColor" />
              )}
              <h1>Моя волна</h1>
            </Button>
            <Collapsible.Trigger asChild>
              <Button
                className={`wave-settings-button ${settings ? "selected" : ""}`}
                aria-expanded={settings}
              >
                <Settings size={14} /> Настроить
              </Button>
            </Collapsible.Trigger>
          </div>
          {active && (
            <div className="wave-now">
              <span>
                <strong>{current.title}</strong>
                <small>{trackArtists(current).join(", ")}</small>
              </span>
              <div className="wave-controls">
                <Button
                  className={`icon-button ${liked ? "is-active" : ""}`}
                  aria-label="Нравится трек"
                  onClick={onLike}
                >
                  <Heart size={19} fill={liked ? "currentColor" : "none"} />
                </Button>
                <Button
                  className="icon-button"
                  aria-label="Меньше похожего"
                  onClick={onDislike}
                >
                  <ThumbsDown size={18} />
                </Button>
                <Button
                  className="icon-button"
                  aria-label="Следующий в волне"
                  onClick={onSkip}
                >
                  <SkipForward size={20} />
                </Button>
              </div>
            </div>
          )}
        </div>
        <Collapsible.Content asChild>
          <section className="wave-preferences">
            <div className="wave-mix">
              <strong>Характер волны</strong>
              <div className="segmented">
                {(
                  [
                    ["balanced", "Баланс"],
                    ["familiar", "Знакомое"],
                    ["discovery", "Открытия"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    className={profile.mix === value ? "active" : ""}
                    onClick={() => onChange({ mix: value })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="section-heading">
              <h2>Что вам нравится?</h2>
              <span className="wave-settings-hint">
                Можно выбрать несколько
              </span>
            </div>
            <div className="genre-choices">
              {tasteGenres.map((genre) => (
                <Button
                  key={genre}
                  className={profile.genres.includes(genre) ? "selected" : ""}
                  onClick={() =>
                    onChange({
                      genres: profile.genres.includes(genre)
                        ? profile.genres.filter((g) => g !== genre)
                        : [...profile.genres, genre],
                    })
                  }
                >
                  {profile.genres.includes(genre) && <Check size={13} />}{" "}
                  {genreLabel(genre)}
                </Button>
              ))}
            </div>
            <div className="wave-energy">
              <span>Настроение</span>
              <div className="segmented">
                {(
                  [
                    ["all", "Любое"],
                    ["calm", "Спокойнее"],
                    ["energetic", "Энергичнее"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    className={profile.energy === value ? "active" : ""}
                    onClick={() => onChange({ energy: value })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <p className="wave-privacy">
              Лайки, дослушивания и пропуски меняют подбор. Профиль хранится на
              этом устройстве.
            </p>
          </section>
        </Collapsible.Content>
        {error && (
          <div className="wave-error" role="alert">
            {error}
            <Button className="text-button" onClick={onStart}>
              Попробовать ещё
            </Button>
          </div>
        )}
        {recommendations.length > 0 && (
          <section className="wave-next">
            <div className="section-heading">
              <h2>Подобрано для вас</h2>
            </div>
            <div className="wave-upcoming">
              {recommendations.slice(0, 8).map((track) => (
                <Button
                  key={track.id}
                  onClick={() => onPlay(track)}
                  aria-label={`Слушать ${track.title}`}
                >
                  <img src={track.cover} alt="" />
                  <span>
                    <strong>{track.title}</strong>
                    <small>
                      {trackArtists(track).join(", ")} · {track.format}
                    </small>
                    <em>{track.recommendationReason}</em>
                  </span>
                </Button>
              ))}
            </div>
          </section>
        )}
      </section>
    </Collapsible.Root>
  );
}
