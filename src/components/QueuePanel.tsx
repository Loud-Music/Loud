import { AudioLines, X } from "lucide-react";
import { time, type Track } from "../lib/library";
import IconButton from "./IconButton";
type Props = {
  current: Track;
  queue: string[];
  tracks: Track[];
  currentId: string;
  playTrack: (track: Track) => void;
  close: () => void;
};
export default function QueuePanel({
  current,
  queue,
  tracks,
  currentId,
  playTrack,
  close,
}: Props) {
  return (
    <aside className="queue-panel" aria-label="Очередь воспроизведения">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ДАЛЕЕ</span>
          <h2>Очередь</h2>
        </div>
        <IconButton icon={X} label="Закрыть очередь" onClick={close} />
      </div>
      <span className="queue-label">СЕЙЧАС ИГРАЕТ</span>
      <div className="queue-track now">
        <img src={current.cover} alt="" />
        <span>
          <strong>{current.title}</strong>
          <small>{current.artist}</small>
        </span>
        <AudioLines size={18} />
      </div>
      <span className="queue-label">В ОЧЕРЕДИ · {queue.length}</span>
      {queue.map((id, index) => {
        const t = tracks.find((track) => track.id === id);
        return t ? (
          <button
            className={`queue-track ${id === currentId ? "active" : ""}`}
            key={`${id}-${index}`}
            onClick={() => playTrack(t)}
          >
            <span className="queue-number">{index + 1}</span>
            <img src={t.cover} alt="" />
            <span>
              <strong>{t.title}</strong>
              <small>{t.artist}</small>
            </span>
            <span className="queue-time">{time(t.duration)}</span>
          </button>
        ) : null;
      })}
      <p className="queue-tip">Пробел — воспроизведение или пауза.</p>
    </aside>
  );
}
