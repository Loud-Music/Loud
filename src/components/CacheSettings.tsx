import SelectField from "./SelectField";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CacheStatus {
  directory: string;
  limitBytes: number;
  sizeBytes: number;
  protectedBytes: number;
  files: number;
  removedBytes: number;
  downloadedBytes: number;
}
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} ГБ`
    : `${(bytes / 1024 ** 2).toFixed(1)} МБ`;

export default function CacheSettings() {
  const desktop = "__TAURI_INTERNALS__" in window;
  const [status, setStatus] = useState<CacheStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    void invoke<CacheStatus>("audio_cache_status").then(
      (value) => {
        if (live) setStatus(value);
      },
      () => {
        if (live) setError("Не удалось прочитать размер кэша.");
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const update = async (command: string, args?: { bytes: number }) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await invoke<CacheStatus>(command, args);
      setStatus(value);
      setMessage(
        `Освобождено ${size(value.removedBytes)}.${value.protectedBytes ? " Используемые записи сохранены." : ""}`,
      );
    } catch {
      setError("Не удалось изменить кэш. Повторите попытку.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="prefs-row">
        <div className="prefs-row-copy">
          <strong>Лимит аудиокэша</strong>
          <p>
            Старые записи удаляются автоматически. Текущий трек и активные
            загрузки сохраняются.
          </p>
        </div>
        <div className="prefs-row-control">
          <SelectField
            aria-label="Лимит аудиокэша"
            value={status?.limitBytes || 2 * 1024 ** 3}
            disabled={!status || busy}
            onValueChange={(value) =>
              void update("audio_cache_limit", {
                bytes: Number(value),
              })
            }
          >
            {[
              256 * 1024 ** 2,
              512 * 1024 ** 2,
              1024 ** 3,
              2 * 1024 ** 3,
              5 * 1024 ** 3,
              10 * 1024 ** 3,
            ].map((bytes) => (
              <option key={bytes} value={bytes}>
                {size(bytes)}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
      <div className="prefs-row">
        <div className="prefs-row-copy">
          <strong>Аудиокэш</strong>
          <p>
            {status
              ? `${size(status.sizeBytes)} · ${status.files} записей`
              : desktop
                ? "Определяем размер…"
                : "Доступен в приложении для компьютера"}
          </p>
        </div>
        <div className="prefs-row-control">
          <Button
            className="prefs-button"
            disabled={!status || busy}
            onClick={() => void update("audio_cache_clear")}
          >
            {busy ? "Подождите…" : "Очистить кэш"}
          </Button>
        </div>
      </div>
      {!!status?.downloadedBytes && (
        <p className="prefs-note">
          Сохранено для прослушивания: {size(status.downloadedBytes)}. Очистка
          кэша не удаляет эти записи.
        </p>
      )}
      {message && (
        <p className="prefs-note" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="prefs-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
