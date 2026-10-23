import { Button } from "@animate-ui/react/primitives/buttons/button";
import { Check, Download, Pause, Play, Refresh, Spinner } from "../icons";
import type { Track } from "../lib/library";
import type { OfflineState } from "../lib/offlineStore";
import type { OfflineProgress } from "../lib/useOffline";
import "../offline.css";

const size = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
export default function DownloadsPage({
  state,
  progress,
  online,
  control,
  play,
}: {
  state: OfflineState;
  progress: Record<string, OfflineProgress>;
  online: boolean;
  control: (ids: string[], action: "pause" | "resume") => void;
  play: (track: Track, list: Track[]) => void;
}) {
  if (!state.groups.length)
    return (
      <div className="empty-state">
        <Download size={36} />
        <h2>Музыка с собой</h2>
        <p>Нажмите «Скачать всё» на странице альбома или плейлиста.</p>
      </div>
    );
  return (
    <section className="offline-page" aria-label="Офлайн-загрузки">
      <p className="offline-note">
        Сохранённая музыка, обложки и тексты хранятся отдельно от аудиокэша.
      </p>
      {!online && (
        <p role="status" className="offline-note">
          Нет соединения. Сохранённые песни доступны, остальные загрузятся после
          подключения.
        </p>
      )}
      {state.groups.map((group) => {
        const jobs = group.tracks.map((id) => state.jobs[id]).filter(Boolean);
        const done = jobs.filter((job) => job.state === "done");
        const running = jobs.some((job) =>
          ["loading", "queued", "retry"].includes(job.state),
        );
        return (
          <section className="offline-group" key={group.id}>
            <header>
              <div>
                <h2>{group.name}</h2>
                <p>
                  {done.length} из {jobs.length} ·{" "}
                  {group.kind === "album"
                    ? "Альбом"
                    : group.kind === "playlist"
                      ? "Плейлист"
                      : "Песни"}
                </p>
              </div>
              <Button
                className="button button-subtle"
                onClick={() =>
                  control(group.tracks, running ? "pause" : "resume")
                }
              >
                {running ? <Pause size={16} /> : <Refresh size={16} />}
                {running
                  ? "Пауза"
                  : done.length === jobs.length
                    ? "Повторить тексты"
                    : "Продолжить"}
              </Button>
            </header>
            <progress
              max={jobs.length || 1}
              value={done.length}
              aria-label={`Скачано песен из ${group.name}`}
            />
            <div className="offline-tracks">
              {jobs.map((job) => {
                const transfer = progress[job.track.id];
                const status =
                  job.state === "done"
                    ? job.lyrics === "words"
                      ? "Скачано · Пословный текст"
                      : job.lyrics === "lines"
                        ? "Скачано · Текст сохранён"
                        : job.lyrics === "missing"
                          ? "Скачано · Текст не найден"
                          : job.lyrics === "retry" || !online
                            ? "Скачано · Текст загрузится позже"
                            : "Скачано · Сохраняем текст…"
                    : job.state === "paused"
                      ? "На паузе"
                      : job.state === "retry"
                        ? "Повторим после обрыва"
                        : job.state === "loading"
                          ? transfer
                            ? `${size(transfer.bytes)}${transfer.total ? ` из ${size(transfer.total)}` : ""}`
                            : "Подготавливаем аудио…"
                          : "В очереди";
                return (
                  <div className="offline-track" key={job.track.id}>
                    <Button
                      className="offline-track-art"
                      disabled={job.state !== "done"}
                      aria-label={`Слушать ${job.track.title}`}
                      onClick={() =>
                        play(
                          job.track,
                          done.map((job) => job.track),
                        )
                      }
                    >
                      <img
                        src={job.track.cover}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.onerror = null;
                          event.currentTarget.src = "/covers/imported.svg";
                        }}
                      />
                      {job.state === "done" && <Play size={16} />}
                    </Button>
                    <div className="offline-track-copy">
                      <strong>{job.track.title}</strong>
                      <span>{job.track.artist}</span>
                      <span role={job.state === "retry" ? "status" : undefined}>
                        {status}
                      </span>
                      {job.error && <p>{job.error}</p>}
                      {job.state === "loading" && transfer?.total && (
                        <progress
                          max={transfer.total}
                          value={transfer.bytes}
                          aria-label={`Загрузка ${job.track.title}`}
                        />
                      )}
                    </div>
                    {job.state === "done" ? (
                      <Check size={18} />
                    ) : job.state === "loading" ? (
                      <Spinner size={18} className="spin" />
                    ) : job.state === "paused" ? (
                      <Pause size={18} />
                    ) : (
                      <Download size={18} />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </section>
  );
}
