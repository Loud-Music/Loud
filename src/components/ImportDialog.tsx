import { Button } from "@animate-ui/react/primitives/buttons/button";
import { useState } from "react";
import { ChevronRight, FolderOpen, Spinner, Waveform } from "../icons";
import { errorMessage } from "../lib/errors";
import { developerToken } from "../lib/apple";
import { AppleIcon, SpotifyIcon } from "./ServiceIcons";
import Dialog from "./Dialog";

type Props = {
  busy: boolean;
  ready: boolean;
  close: () => void;
  onChoose: () => void;
  onBrowse: () => void;
  onApple: () => Promise<void>;
  onSoundCloud: (url: string) => Promise<void>;
};
export default function ImportDialog({
  busy,
  ready,
  close,
  onChoose,
  onBrowse,
  onApple,
  onSoundCloud,
}: Props) {
  const [soundCloud, setSoundCloud] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const connected = !!developerToken();
  const disabled = busy || !ready;
  return (
    <Dialog
      title="Импорт музыки"
      close={close}
      busy={busy}
      className="import-dialog"
    >
      <p className="dialog-description">
        Добавьте музыку с устройства или перенесите свою медиатеку.
      </p>
      <section aria-label="Аудиофайлы с устройства" className="import-local">
        <FolderOpen size={24} aria-hidden="true" />
        <div className="import-local-copy">
          <h3>Аудиофайлы</h3>
          <p>FLAC, MP3, M4A, WAV, OGG и OPUS</p>
        </div>
        <Button
          autoFocus
          className="button button-accent"
          disabled={disabled}
          aria-busy={busy}
          onClick={onChoose}
        >
          {busy && <Spinner size={16} className="spin" />}
          {busy ? "Добавляем…" : "Выбрать файлы"}
        </Button>
      </section>
      <section
        aria-labelledby="import-library-title"
        className="import-library"
      >
        <h3 id="import-library-title">Из другой медиатеки</h3>
        <div className="import-sources">
          <Button
            className="import-source"
            disabled={disabled}
            aria-expanded={soundCloud}
            aria-controls="soundcloud-import"
            onClick={() => setSoundCloud((value) => !value)}
          >
            <span className="import-source-icon">
              <Waveform size={24} />
            </span>
            <span className="import-source-copy">
              <strong>SoundCloud</strong>
              <span>Публичный трек или плейлист по ссылке</span>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
          {soundCloud && (
            <form
              id="soundcloud-import"
              className="soundcloud-import"
              onSubmit={async (event) => {
                event.preventDefault();
                if (disabled) return;
                setError("");
                try {
                  await onSoundCloud(url.trim());
                } catch (cause) {
                  setError(
                    errorMessage(cause, "Не удалось импортировать SoundCloud."),
                  );
                }
              }}
            >
              <label htmlFor="soundcloud-url">Ссылка SoundCloud</label>
              <div className="soundcloud-import-input">
                <input
                  id="soundcloud-url"
                  type="url"
                  required
                  autoFocus
                  placeholder="https://soundcloud.com/…"
                  value={url}
                  disabled={disabled}
                  onChange={(event) => setUrl(event.target.value)}
                />
                <Button
                  className="button button-accent"
                  type="submit"
                  disabled={disabled || !url.trim()}
                >
                  {busy ? (
                    <Spinner size={16} className="spin" />
                  ) : (
                    "Импортировать"
                  )}
                </Button>
              </div>
              <p role={error ? "alert" : "status"}>
                {error ||
                  (busy
                    ? "Получаем песни. Первый импорт может потребовать установки компонента…"
                    : "Переносится список песен. Аудио загружается при воспроизведении.")}
              </p>
            </form>
          )}
          <Button
            className="import-source"
            disabled={disabled}
            onClick={() => (connected ? void onApple() : onBrowse())}
            aria-label={
              connected
                ? "Подключить Apple Music"
                : "Импортировать XML из Apple Music"
            }
          >
            <span className="import-source-icon">
              <AppleIcon size={24} />
            </span>
            <span className="import-source-copy">
              <strong>Apple Music</strong>
              <span>
                {connected ? "Подключить медиатеку" : "Экспорт медиатеки в XML"}
              </span>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
          <Button
            className="import-source"
            disabled={disabled}
            onClick={onBrowse}
            aria-label="Импортировать плейлист из CSV"
          >
            <span className="import-source-icon">
              <SpotifyIcon monochrome />
            </span>
            <span className="import-source-copy">
              <strong>Spotify и другие сервисы</strong>
              <span>Плейлисты в формате CSV</span>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </section>
      <p className="import-footnote" role={!ready ? "status" : undefined}>
        {!ready
          ? "Подготавливаем медиатеку…"
          : "XML и CSV переносят список песен. Аудиофайлы добавляются отдельно."}
      </p>
    </Dialog>
  );
}
