import { errorMessage } from "../lib/errors";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, LoaderCircle, RotateCw } from "lucide-react";

type Status = { ready: boolean; version: string };
const jobs = new Map<string, Promise<Status>>();
const componentNames: Record<string, string> = {
  ensure_media_tools: "FFmpeg",
  ensure_music_module: "SpotiFLAC",
  ensure_extractor_tool: "yt-dlp",
};
function setup(command: string) {
  let job = jobs.get(command);
  if (!job) {
    job = invoke<Status>(command).catch((error) => {
      jobs.delete(command);
      throw new Error(
        `Ошибка подготовки ${componentNames[command] || command}: ${String(error)}`,
      );
    });
    jobs.set(command, job);
  }
  return job;
}
export function initializeMusicTools() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  for (const command of [
    "ensure_media_tools",
    "ensure_music_module",
    "ensure_extractor_tool",
  ])
    void setup(command).catch(() => {});
}
export function PlaybackSetup() {
  const [state, setState] = useState("loading");
  const [visible, setVisible] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let live = true;
    setState("loading");
    setError("");
    const timer = window.setTimeout(() => setVisible(true), 700);
    void Promise.all(
      [
        "ensure_media_tools",
        "ensure_music_module",
        "ensure_extractor_tool",
      ].map(setup),
    ).then(
      () => {
        if (live) setState("ready");
      },
      (error) => {
        if (live) {
          setState("error");
          setError(errorMessage(error));
          setVisible(true);
        }
      },
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [revision]);
  useEffect(() => {
    const retry = () => {
      if (state === "error") setRevision((value) => value + 1);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [state]);
  if (!("__TAURI_INTERNALS__" in window) || !visible || state === "ready")
    return null;
  return (
    <div className="playback-setup-status" role="status">
      {state === "error" ? (
        <>
          <span>
            Не удалось подготовить воспроизведение.
            <details className="playback-setup-details">
              <summary>Подробности</summary>
              <pre>{error}</pre>
            </details>
          </span>
          <button
            className="text-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Повторить
          </button>
        </>
      ) : (
        <>
          <LoaderCircle className="spin" size={16} />
          <span>
            Подготовка воспроизведения… При первом запуске это займёт немного
            времени.
          </span>
        </>
      )}
    </div>
  );
}
function Tool({ command, name }: { command: string; name: string }) {
  const [status, setStatus] = useState("Подготовка…");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus("Подготовка…");
    setError("");
    void setup(command)
      .then((result) => {
        if (active) setStatus(`Готово · ${result.version}`);
      })
      .catch((error) => {
        if (active) {
          setStatus("Не удалось подготовить");
          setError(errorMessage(error));
        }
      });
    return () => {
      active = false;
    };
  }, [command, revision]);
  return (
    <div className="music-tool">
      <span>
        <strong>{name}</strong>
        <small>{status}</small>
        {error && <p role="alert">{error}</p>}
      </span>
      {error ? (
        <button
          className="icon-button"
          aria-label={`Повторить установку ${name}`}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RotateCw size={16} />
        </button>
      ) : status.startsWith("Готово") ? (
        <Check size={17} />
      ) : (
        <LoaderCircle className="spin" size={17} />
      )}
    </div>
  );
}
export default function MusicTools() {
  if (!("__TAURI_INTERNALS__" in window))
    return (
      <p className="dialog-description">
        Компоненты доступны в приложении для компьютера.
      </p>
    );
  return (
    <section className="music-tools" aria-label="Компоненты воспроизведения">
      <h3>Компоненты</h3>
      <p>Устанавливаются автоматически.</p>
      <Tool name="FFmpeg + FFprobe" command="ensure_media_tools" />
      <Tool name="yt-dlp" command="ensure_extractor_tool" />
      <Tool name="Модуль SpotiFLAC" command="ensure_music_module" />
      <p>Доступность музыки зависит от подключённых сервисов.</p>
    </section>
  );
}
