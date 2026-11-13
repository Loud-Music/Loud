import RangeField from "./RangeField";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Heart,
  Shuffle,
  SkipBack,
  SkipForward,
  Spinner,
  Pause,
  Play,
  Repeat,
  VolumeOff,
  VolumeLow,
  VolumeHigh,
  Lyrics,
  Queue,
} from "../icons";
import { time, type Track } from "../lib/library";
import type usePlayback from "../lib/usePlayback";
import IconButton from "./IconButton";
import ArtistNames from "./ArtistNames";
import { usePlaybackProgress } from "../lib/playbackProgress";
type Props = Pick<
  ReturnType<typeof usePlayback>,
  | "playing"
  | "duration"
  | "seek"
  | "togglePlay"
  | "output"
  | "exclusive"
  | "playbackFormat"
  | "volume"
  | "setVolume"
> & {
  current: Track;
  favorites: string[];
  shuffle: boolean;
  repeat: boolean;
  lyricsOpen: boolean;
  queueOpen: boolean;
  audioLoading: boolean;
  openAlbum: (track: Track) => void;
  openArtist: (artist: string) => void;
  toggleFavorite: (id: string) => void;
  advance: (direction: number) => void;
  setShuffle: Dispatch<SetStateAction<boolean>>;
  setRepeat: Dispatch<SetStateAction<boolean>>;
  setLyricsOpen: Dispatch<SetStateAction<boolean>>;
  setQueueOpen: Dispatch<SetStateAction<boolean>>;
  onSettings: () => void;
};
export default function Player({
  playing,
  current,
  favorites,
  duration,
  seek,
  shuffle,
  setShuffle,
  advance,
  audioLoading,
  togglePlay,
  repeat,
  setRepeat,
  output,
  exclusive,
  playbackFormat,
  volume,
  setVolume,
  lyricsOpen,
  setLyricsOpen,
  queueOpen,
  setQueueOpen,
  openAlbum,
  openArtist,
  toggleFavorite,
  onSettings,
}: Props) {
  return (
    <footer
      className={`player ${playing ? "is-playing" : ""}`}
      style={
        {
          "--player-art": current.id
            ? `url(${JSON.stringify(current.cover)})`
            : "none",
        } as React.CSSProperties
      }
    >
      <div className="now-playing">
        <Button
          className="now-cover"
          onClick={() => openAlbum(current)}
          aria-label="Открыть текущий альбом"
        >
          <img src={current.cover} alt="Обложка текущего альбома" />
        </Button>
        <div className="now-info" key={current.id}>
          <strong>{current.title}</strong>
          <span className="now-artist">
            <ArtistNames track={current} onOpen={openArtist} />
          </span>
        </div>
        <IconButton
          icon={Heart}
          label="Добавить текущую песню в избранное"
          disabled={!current.id}
          active={favorites.includes(current.id)}
          className="favorite-button"
          onClick={() => toggleFavorite(current.id)}
        />
      </div>
      <div className="transport">
        <div className="transport-buttons">
          <IconButton
            icon={Shuffle}
            label="Перемешать"
            active={shuffle}
            onClick={() => setShuffle((s) => !s)}
          />
          <IconButton
            icon={SkipBack}
            label="Предыдущий трек"
            onClick={() => advance(-1)}
          />
          <Button
            className="main-play"
            aria-label={playing ? "Пауза" : "Слушать"}
            disabled={!current.src}
            onClick={togglePlay}
          >
            {audioLoading ? (
              <Spinner className="spin" size={20} />
            ) : playing ? (
              <Pause size={20} fill="currentColor" />
            ) : (
              <Play size={20} fill="currentColor" />
            )}
          </Button>
          <IconButton
            icon={SkipForward}
            label="Следующий трек"
            onClick={() => advance(1)}
          />
          <IconButton
            icon={Repeat}
            label="Повторять очередь"
            active={repeat}
            onClick={() => setRepeat((r) => !r)}
          />
        </div>
      </div>
      <div className="player-right">
        <Button
          className={`output-indicator ${output.exclusive ? "exclusive-active" : ""}`}
          onClick={() => {
            onSettings();
          }}
          title={
            output.error ||
            (output.exclusive
              ? `WASAPI Exclusive · ${output.device} · ${output.bits} бит / ${output.sampleRate} Гц`
              : exclusive
                ? "Эксклюзивный режим включён. Выберите трек FLAC."
                : "Системный вывод звука")
          }
        >
          {output.exclusive
            ? `${output.bits} бит / ${(output.sampleRate / 1000).toFixed(1)} кГц`
            : exclusive
              ? "Эксклюзивный"
              : playbackFormat || current.format || "Системный"}
        </Button>
        <div className="volume-control">
          <IconButton
            icon={
              volume === 0 ? VolumeOff : volume < 0.5 ? VolumeLow : VolumeHigh
            }
            label={volume === 0 ? "Включить звук" : "Выключить звук"}
            disabled={exclusive}
            onClick={() => setVolume((v) => (v === 0 ? 0.65 : 0))}
          />
          <RangeField
            aria-label="Громкость"
            disabled={exclusive}
            title={
              exclusive
                ? "В эксклюзивном режиме регулируйте громкость на ЦАП или усилителе"
                : "Громкость"
            }

            min="0"
            max="1"
            step="0.01"
            value={volume}
            style={
              {
                "--range-progress": `${volume * 100}%`,
              } as React.CSSProperties
            }
            onValueChange={(value) => setVolume(Number(value))}
          />
        </div>
        <IconButton
          icon={Lyrics}
          label="Текст песни"
          active={lyricsOpen}
          onClick={() => {
            setLyricsOpen((v) => !v);
            setQueueOpen(false);
          }}
        />
        <span className="player-divider" />
        <IconButton
          icon={Queue}
          label="Очередь воспроизведения"
          active={queueOpen}
          onClick={() => {
            setQueueOpen((q) => !q);
            setLyricsOpen(false);
          }}
        />
      </div>
      <SeekBar key={current.id} duration={duration} seek={seek} />
    </footer>
  );
}

function SeekBar({ duration, seek }: Pick<Props, "duration" | "seek">) {
  const progress = usePlaybackProgress();
  const dragging = useRef(false);
  const [preview, setPreview] = useState<number>();
  const position = Math.min(preview ?? progress, duration || 0);
  const finishDrag = () => {
    dragging.current = false;
    setPreview(undefined);
  };
  return (
    <div
      className="seek-bar"
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
    >
      <span>{time(position)}</span>
      <RangeField
        aria-label="Позиция воспроизведения"
        aria-valuetext={time(position)}
        disabled={!duration}
        min={0}
        max={duration || 1}
        value={position}
        step={0.1}
        onPointerDown={() => {
          dragging.current = true;
          setPreview(progress);
        }}
        onPointerUp={finishDrag}
        onValueChange={(value) => {
          if (dragging.current) setPreview(value);
        }}
        onValueCommit={seek}
      />
      <span>{time(duration)}</span>
    </div>
  );
}
