import {
  ArrowDownToLine,
  ArrowRight,
  Folder,
  LoaderCircle,
} from "lucide-react";
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
};
export default function ImportDialog({
  busy,
  ready,
  close,
  onChoose,
  onBrowse,
  onApple,
}: Props) {
  return (
    <Dialog title={"Импорт музыки"} close={close} busy={busy}>
      <>
        <p className="dialog-description">
          Добавьте аудиофайлы или импортируйте медиатеку другого сервиса.
        </p>
        <button
          autoFocus
          className="drop-zone"
          onClick={() => {
            onChoose();
          }}
          disabled={busy || !ready}
        >
          {busy ? (
            <LoaderCircle size={30} className="spin" />
          ) : (
            <ArrowDownToLine size={30} />
          )}
          <strong>{busy ? "Импорт…" : "Выбрать файлы"}</strong>
          <span>
            или <b>открыть папку</b>
          </span>
          <small>MP3, FLAC, WAV, M4A, OGG · Медиатеки XML и CSV</small>
        </button>
        <div className="import-divider">
          <span /> ИМПОРТ ИЗ СЕРВИСА <span />
        </div>
        <div className="import-provider">
          <span className="provider-icon apple">
            <AppleIcon size={25} />
          </span>
          <div>
            <strong>Apple Music</strong>
            <p>
              {developerToken()
                ? "Подключите профиль через MusicKit."
                : "Импортируйте медиатеку в формате XML."}
            </p>
          </div>
          <button
            className="button button-subtle"
            disabled={busy || !ready}
            onClick={() => (developerToken() ? void onApple() : onBrowse())}
          >
            {developerToken() ? "Подключить" : "Импорт XML"}
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="import-provider">
          <span className="provider-icon">
            <SpotifyIcon />
          </span>
          <div>
            <strong>Spotify и другие сервисы</strong>
            <p>Импортируйте плейлист в формате CSV.</p>
          </div>
          <button
            className="button button-subtle"
            disabled={busy || !ready}
            onClick={() => onBrowse()}
          >
            Импорт CSV
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="import-note">
          <Folder size={16} />
          <p>
            Аудиофайлы хранятся на этом устройстве. Из XML и CSV импортируются
            сведения о песнях; для воспроизведения добавьте аудиофайлы.
          </p>
        </div>
      </>
    </Dialog>
  );
}
