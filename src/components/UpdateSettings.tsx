import { Button } from "@animate-ui/react/primitives/buttons/button";
import { useState } from "react";
import { currentUpdate, checkUpdates } from "../lib/updates";
import { relaunch } from "@tauri-apps/plugin-process";
import { flushPersistence } from "../lib/persistence";

export default function UpdateSettings() {
  const [update, setUpdate] = useState(currentUpdate);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run() {
    setBusy(true);
    try {
      if (update) {
        let downloaded = 0;
        let total = 0;
        await update.download((event) => {
          if (event.event === "Started") total = event.data.contentLength ?? 0;
          if (event.event === "Progress") downloaded += event.data.chunkLength;
          setMessage(
            total
              ? `Загрузка: ${Math.min(100, Math.round((downloaded / total) * 100))}%`
              : "Загрузка обновления…",
          );
        });
        await flushPersistence();
        await update.install();
        await relaunch();
      } else {
        const found = await checkUpdates();
        setUpdate(found);
        setMessage(
          found
            ? `Доступна версия ${found.version}`
            : "Установлена последняя версия",
        );
      }
    } catch {
      setMessage("Не удалось получить обновление. Попробуйте позже.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="prefs-group">
      <Button
        className="prefs-button"
        disabled={busy || !("__TAURI_INTERNALS__" in window)}
        onClick={() => void run()}
      >
        {busy
          ? "Подождите…"
          : update
            ? "Установить и перезапустить"
            : "Проверить обновления"}
      </Button>
      {message && (
        <p role="status" className="prefs-note">
          {message}
        </p>
      )}
    </div>
  );
}
