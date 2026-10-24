import { useRef, useState } from "react";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import RangeField from "../components/RangeField";
import { Pause, Play } from "../icons";
import { media } from "./api";

export default function PreviewAudio({
  path,
  onError,
}: {
  path: string;
  onError: (value: string) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const time = (value: number) =>
    `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
  return (
    <div className="studio-preview-player">
      <audio
        ref={audio}
        preload="none"
        src={media(path)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) =>
          setDuration(
            Number.isFinite(e.currentTarget.duration)
              ? e.currentTarget.duration
              : 0,
          )
        }
        onError={() =>
          onError(
            "Не удалось открыть мастер для прослушивания. Попробуй ещё раз.",
          )
        }
      />
      <Button
        className="icon-button"
        aria-label={playing ? "Пауза" : "Послушать мастер"}
        onClick={async () => {
          if (!audio.current) return;
          if (playing) audio.current.pause();
          else {
            onError("");
            try {
              await audio.current.play();
            } catch {
              onError("Не удалось запустить прослушивание мастера.");
            }
          }
        }}
      >
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </Button>
      <span>{time(progress)}</span>
      <RangeField
        aria-label="Позиция прослушивания мастера"
        value={progress}
        max={duration || 1}
        step={0.1}
        disabled={!duration}
        onValueChange={(value) => {
          if (audio.current) {
            audio.current.currentTime = value;
            setProgress(value);
          }
        }}
      />
      <span>{time(duration)}</span>
    </div>
  );
}
