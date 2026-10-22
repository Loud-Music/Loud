import { trackArtists } from "../lib/library";
import { useState } from "react";
import type { RefObject } from "react";
import type { EqualizerGraph } from "../lib/equalizer";
import WaveShader from "./WaveShader";
import {
  Check,
  Heart,
  LoaderCircle,
  Play,
  Pause,
  Settings2,
  SkipForward,
  ThumbsDown,
} from "lucide-react";
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
          <button
            className="wave-start"
            disabled={loading && !active}
            onClick={onStart}
            aria-label={
              active && playing ? "Приостановить волну" : "Включить мою волну"
            }
          >
            {loading && !active ? (
              <LoaderCircle className="spin" size={27} />
            ) : active && playing ? (
              <Pause size={27} fill="currentColor" />
            ) : (
              <Play size={27} fill="currentColor" />
            )}
            <h1>Моя волна</h1>
          </button>
          <button
            className={`wave-settings-button ${settings ? "selected" : ""}`}
            onClick={() => setSettings((value) => !value)}
            aria-expanded={settings}
          >
            <Settings2 size={14} /> Настроить
          </button>
        </div>
        {active && (
          <div className="wave-now">
            <span>
              <strong>{current.title}</strong>
              <small>{trackArtists(current).join(", ")}</small>
            </span>
            <div className="wave-controls">
              <button
                className={`icon-button ${liked ? "is-active" : ""}`}
                aria-label="Нравится трек"
                onClick={onLike}
              >
                <Heart size={19} fill={liked ? "currentColor" : "none"} />
              </button>
              <button
                className="icon-button"
                aria-label="Меньше похожего"
                onClick={onDislike}
              >
                <ThumbsDown size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Следующий в волне"
                onClick={onSkip}
              >
                <SkipForward size={20} />
              </button>
            </div>
          </div>
        )}
      </div>
      {settings && (
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
                <button
                  key={value}
                  className={profile.mix === value ? "active" : ""}
                  onClick={() => onChange({ mix: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="section-heading">
            <h2>Что вам нравится?</h2>
            <span className="wave-settings-hint">Можно выбрать несколько</span>
          </div>
          <div className="genre-choices">
            {tasteGenres.map((genre) => (
              <button
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
              </button>
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
                <button
                  key={value}
                  className={profile.energy === value ? "active" : ""}
                  onClick={() => onChange({ energy: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="wave-privacy">
            Лайки, дослушивания и пропуски меняют подбор. Профиль хранится на
            этом устройстве.
          </p>
        </section>
      )}
      {error && (
        <div className="wave-error" role="alert">
          {error}
          <button className="text-button" onClick={onStart}>
            Попробовать ещё
          </button>
        </div>
      )}
      {recommendations.length > 0 && (
        <section className="wave-next">
          <div className="section-heading">
            <h2>Подобрано для вас</h2>
          </div>
          <div className="wave-upcoming">
            {recommendations.slice(0, 8).map((track) => (
              <button
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
              </button>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
