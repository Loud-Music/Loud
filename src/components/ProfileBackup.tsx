import { useRef, useState } from "react";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { Download, Upload } from "../icons";
import type { Track } from "../lib/library";
import {
  exportProfile,
  readProfileBackup,
  restoreProfileBackup,
  type ProfileBackup as Backup,
} from "../lib/profileBackup";

export default function ProfileBackup({
  account,
  tracks,
}: {
  account: { id: string; name: string };
  tracks: Track[];
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<Backup>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="prefs-group">
      <h3>Копия профиля</h3>
      <div className="prefs-group-body">
        <div className="prefs-source-fields">
          <p className="prefs-note">
            Лайки, плейлисты, подписки, настройки и данные песен сохраняются в
            файл .loudbackup. Аудиофайлы и ключи доступа в копию не входят.
          </p>
          <div className="prefs-source-actions">
            <Button
              className="prefs-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await exportProfile(account, tracks);
                } catch (reason) {
                  setError(
                    String(reason instanceof Error ? reason.message : reason),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Download size={15} /> Сохранить копию
            </Button>
            <Button
              className="prefs-button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={15} /> Восстановить…
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".loudbackup,application/json"
              hidden
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setBusy(true);
                setError("");
                setBackup(undefined);
                try {
                  setBackup(await readProfileBackup(file));
                } catch (reason) {
                  setError(
                    String(reason instanceof Error ? reason.message : reason),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
          {backup && (
            <div className="backup-preview" role="status">
              <strong>
                {backup.name} ·{" "}
                {new Date(backup.createdAt).toLocaleDateString("ru-RU")}
              </strong>
              <p>
                {backup.tracks.length} треков ·{" "}
                {(backup.settings.favorites as string[] | undefined)?.length ||
                  0}{" "}
                лайков ·{" "}
                {(backup.settings.playlists as unknown[] | undefined)?.length ||
                  0}{" "}
                плейлистов
              </p>
              <p>
                Данные добавятся в текущий профиль. Существующие песни и
                плейлисты сохранятся, настройки будут восстановлены из копии. На
                другом компьютере локальные аудиофайлы нужно добавить отдельно.
              </p>
              <div className="prefs-source-actions">
                <Button
                  className="prefs-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await restoreProfileBackup(backup, tracks);
                      location.reload();
                    } catch (reason) {
                      setError(
                        String(
                          reason instanceof Error ? reason.message : reason,
                        ),
                      );
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Восстанавливаем…" : "Объединить и перезапустить"}
                </Button>
                <Button
                  className="prefs-button"
                  disabled={busy}
                  onClick={() => setBackup(undefined)}
                >
                  Отмена
                </Button>
              </div>
            </div>
          )}
          {error && (
            <p className="prefs-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
