import { version } from "../../package.json";
import Equalizer from "./Equalizer";
import UpdateSettings from "./UpdateSettings";
import type { EqualizerSettings } from "../lib/equalizer";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AudioLines,
  Check,
  ChevronRight,
  Folder,
  Info,
  Keyboard,
  Settings2,
  SlidersHorizontal,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../lib/library";
import type { OutputStatus } from "../lib/usePlayback";
import { exclusiveAvailable } from "../lib/usePlayback";
import MusicTools from "./MusicTools";
import CacheSettings from "./CacheSettings";
import DiscordSettings from "./DiscordSettings";
import "../settings.css";

const sections = [
  { id: "general", name: "Основные", icon: Settings2 },
  { id: "playback", name: "Воспроизведение", icon: AudioLines },
  { id: "files", name: "Файлы", icon: Folder },
  { id: "advanced", name: "Дополнительно", icon: SlidersHorizontal },
  { id: "about", name: "О программе", icon: Info },
] as const;
type Section = (typeof sections)[number]["id"];
function Group({
  title,
  children,
  note,
}: {
  title?: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className="prefs-group">
      {title && <h3>{title}</h3>}
      <div className="prefs-group-body">{children}</div>
      {note && <p className="prefs-note">{note}</p>}
    </section>
  );
}
function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="prefs-row">
      <div className="prefs-row-copy">
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="prefs-row-control">{children}</div>}
    </div>
  );
}
export default function SettingsDialog({
  theme,
  onTheme,
  initialSection = "general",
  equalizer,
  gapless,
  onGapless,
  onEqualizer,
  preferExclusive,
  onExclusive,
  exclusive,
  output,
  volume,
  onVolume,
  accountName,
  tracks,
  playlistCount,
  onImport,
  onSwitchAccount,
  close,
}: {
  initialSection?: "general" | "playback";
  equalizer: EqualizerSettings;
  gapless: boolean;
  onGapless: (enabled: boolean) => void;
  onEqualizer: (value: EqualizerSettings) => void;
  theme: string;
  onTheme: (theme: string) => void;
  preferExclusive: boolean;
  onExclusive: (value: boolean) => void;
  exclusive: boolean;
  output: OutputStatus;
  volume: number;
  onVolume: (value: number) => void;
  accountName: string;
  tracks: Track[];
  playlistCount: number;
  onImport: () => void;
  onSwitchAccount: () => void;
  close: () => void;
}) {
  const [section, setSection] = useState<Section>(initialSection);
  const [toolsVisible, setToolsVisible] = useState(false);
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState("");
  const panel = useRef<HTMLElement>(null);
  const desktop = "__TAURI_INTERNALS__" in window;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.focus();
    if (desktop)
      void invoke<{ directory: string }>("audio_cache_status")
        .then((status) => setDirectory(status.directory))
        .catch(() => {});
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const active = sections.find((item) => item.id === section)!;
  const albums = new Set(
    tracks.map((track) => `${track.artist}:${track.album}`),
  ).size;
  return (
    <div
      className="modal-backdrop prefs-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="prefs-window"
        role="dialog"
        aria-modal="true"
        aria-label="Настройки"
        ref={panel}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
            return;
          }
          if (event.key !== "Tab") return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled):not([tabindex="-1"]),input:not(:disabled),select:not(:disabled),a[href]',
            ),
          );
          const first = items[0],
            last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <aside className="prefs-sidebar">
          <div className="prefs-brand">
            <span>
              <img src="/mascot.svg" alt="" width={30} height={26} />
            </span>
            <div>
              <strong>Loud</strong>
              <small>Настройки</small>
            </div>
          </div>
          <div
            className="prefs-tabs"
            role="tablist"
            aria-label="Разделы настроек"
            aria-orientation="vertical"
            onKeyDown={(event) => {
              const index = sections.findIndex((item) => item.id === section);
              const next =
                event.key === "ArrowDown"
                  ? (index + 1) % sections.length
                  : event.key === "ArrowUp"
                    ? (index + sections.length - 1) % sections.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? sections.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setSection(sections[next].id);
              panel.current
                ?.querySelector<HTMLElement>(`#prefs-tab-${sections[next].id}`)
                ?.focus();
            }}
          >
            {sections.map(({ id, name, icon: Icon }) => (
              <button
                key={id}
                id={`prefs-tab-${id}`}
                role="tab"
                aria-selected={section === id}
                aria-controls={`prefs-panel-${id}`}
                tabIndex={section === id ? 0 : -1}
                className={section === id ? "is-selected" : ""}
                onClick={() => setSection(id)}
              >
                <Icon size={17} />
                <span>{name}</span>
              </button>
            ))}
          </div>
          <div className="prefs-sidebar-account">
            <UserRound size={16} />
            <span>{accountName}</span>
          </div>
        </aside>
        <div className="prefs-main">
          <header className="prefs-header">
            <h2>{active.name}</h2>
            <button
              className="prefs-close"
              aria-label="Закрыть окно"
              onClick={close}
            >
              <X size={16} />
            </button>
          </header>
          <div
            className="prefs-content"
            role="tabpanel"
            id={`prefs-panel-${section}`}
            aria-labelledby={`prefs-tab-${section}`}
            key={section}
          >
            {section === "general" && (
              <>
                <Group title="Оформление">
                  <div
                    className="prefs-appearance"
                    role="group"
                    aria-label="Оформление"
                  >
                    {["light", "dark"].map((value) => (
                      <button
                        key={value}
                        aria-label={value}
                        aria-pressed={theme === value}
                        onClick={() => onTheme(value)}
                        className={`prefs-theme ${theme === value ? "is-selected" : ""}`}
                      >
                        <span
                          className={`prefs-theme-preview ${value}`}
                          aria-hidden="true"
                        >
                          <i />
                          <b>
                            <em />
                            <em />
                            <em />
                          </b>
                        </span>
                        <span>
                          {value === "dark" ? "Тёмное" : "Светлое"}
                          {theme === value && <Check size={14} />}
                        </span>
                      </button>
                    ))}
                  </div>
                </Group>
                <Group
                  title="Учётная запись"
                  note="Медиатека и настройки хранятся на этом устройстве."
                >
                  <Row
                    title={accountName}
                    description="Локальная учётная запись"
                  >
                    <button className="prefs-button" onClick={onSwitchAccount}>
                      Сменить
                    </button>
                  </Row>
                </Group>
                <DiscordSettings />
                <Group title="Медиатека">
                  <Row title="Песни">
                    <span className="prefs-value">{tracks.length}</span>
                  </Row>
                  <Row title="Альбомы">
                    <span className="prefs-value">{albums}</span>
                  </Row>
                  <Row title="Плейлисты">
                    <span className="prefs-value">{playlistCount}</span>
                  </Row>
                </Group>
              </>
            )}
            {section === "playback" && (
              <>
                <Group
                  title="Переход между песнями"
                  note="Подготовленные треки воспроизводятся непрерывно в системном выводе. Если следующая запись ещё загружается, переход продолжится после её подготовки."
                >
                  <Row title="Без пауз между треками">
                    <button
                      type="button"
                      role="switch"
                      aria-label="Воспроизведение без пауз"
                      aria-checked={gapless}
                      className="prefs-switch"
                      onClick={() => onGapless(!gapless)}
                    >
                      <span />
                    </button>
                  </Row>
                </Group>
                <Group
                  title="Качество аудио"
                  note="Если FLAC недоступен, Loud выбирает полную запись в MP3 или AAC."
                >
                  <Row
                    title="Предпочитаемый формат"
                    description="Исходное качество без перекодирования."
                  >
                    <span className="prefs-quality">Без потерь</span>
                  </Row>
                  <Row title="Вывод звука">
                    <select
                      aria-label="Вывод звука"
                      value={preferExclusive ? "exclusive" : "system"}
                      onChange={(event) =>
                        onExclusive(event.target.value === "exclusive")
                      }
                    >
                      <option value="system">Системный</option>
                      <option
                        value="exclusive"
                        disabled={!exclusiveAvailable()}
                      >
                        WASAPI Exclusive
                      </option>
                    </select>
                  </Row>
                  <Row
                    title="Эксклюзивный режим"
                    description="FLAC воспроизводится с исходной частотой и разрядностью."
                  >
                    <button
                      type="button"
                      role="switch"
                      aria-label="Эксклюзивный режим"
                      aria-checked={preferExclusive}
                      disabled={!exclusiveAvailable()}
                      className="prefs-switch"
                      onClick={() => onExclusive(!preferExclusive)}
                    >
                      <span />
                    </button>
                  </Row>
                </Group>
                <Group
                  title="Громкость"
                  note={
                    exclusive
                      ? "В эксклюзивном режиме регулируйте громкость на устройстве."
                      : undefined
                  }
                >
                  <Row title="Уровень звука">
                    <Volume2 size={16} />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      disabled={exclusive}
                      onChange={(event) => onVolume(Number(event.target.value))}
                      aria-label="Громкость воспроизведения"
                    />
                    <span className="prefs-volume-value">
                      {Math.round(volume * 100)}%
                    </span>
                  </Row>
                </Group>
                <Equalizer value={equalizer} onChange={onEqualizer} />
                <Group title="Текущее устройство">
                  <Row
                    title={output.exclusive ? output.device : "Системный вывод"}
                    description={
                      output.exclusive
                        ? `${output.bits} бит · ${output.sampleRate.toLocaleString("ru-RU")} Гц · ${output.channels} канала`
                        : preferExclusive
                          ? "MP3 и сетевые потоки используют системный вывод. FLAC открывает устройство напрямую."
                          : "Громкостью и обработкой звука управляет система."
                    }
                  />
                </Group>
                {output.error && (
                  <p className="prefs-error" role="alert">
                    {output.error}
                  </p>
                )}
              </>
            )}
            {section === "files" && (
              <>
                <Group title="Медиатека">
                  <Row
                    title="Добавить музыку"
                    description="Аудиофайлы, медиатека Apple Music или плейлист CSV"
                  >
                    <button className="prefs-button" onClick={onImport}>
                      Импортировать…
                    </button>
                  </Row>
                  <Row title="Загружено в медиатеку">
                    <span className="prefs-value">
                      {tracks.filter((track) => track.downloaded).length} треков
                    </span>
                  </Row>
                </Group>
                <Group
                  title="Хранилище"
                  note="Кэшированные треки воспроизводятся с диска без повторной загрузки."
                >
                  <CacheSettings />
                  <Row
                    title="Папка кэша"
                    description={
                      directory ||
                      (desktop
                        ? "Определяем расположение…"
                        : "Доступна в приложении для компьютера")
                    }
                  >
                    <button
                      className="prefs-button"
                      disabled={!directory}
                      onClick={() => {
                        setError("");
                        void invoke("show_music_folder").catch(() =>
                          setError("Не удалось открыть папку."),
                        );
                      }}
                    >
                      Показать
                    </button>
                  </Row>
                </Group>
                {error && (
                  <p className="prefs-error" role="alert">
                    {error}
                  </p>
                )}
              </>
            )}
            {section === "advanced" && (
              <>
                <Group title="Тексты песен">
                  <Row
                    title="Пословная синхронизация"
                    description="Используются настоящие временные метки нужной записи."
                  />
                  <Row
                    title="Предзагрузка"
                    description="Текст текущей и следующей песни загружается заранее и сохраняется на устройстве."
                  />
                </Group>
                <Group title="Клавиатура">
                  <Row title="Воспроизведение / пауза">
                    <kbd>Пробел</kbd>
                  </Row>
                  <Row title="Поиск музыки">
                    <kbd>Ctrl K</kbd>
                  </Row>
                  <Row title="Закрыть окно">
                    <kbd>Esc</kbd>
                  </Row>
                </Group>
                <div className="prefs-disclosure">
                  <button
                    aria-expanded={toolsVisible}
                    onClick={() => setToolsVisible((value) => !value)}
                  >
                    <ChevronRight
                      size={14}
                      className={toolsVisible ? "is-open" : ""}
                    />
                    <Keyboard size={16} />
                    Компоненты воспроизведения
                  </button>
                  {toolsVisible && <MusicTools />}
                </div>
              </>
            )}
            {section === "about" && (
              <div className="prefs-about">
                <span className="prefs-app-icon">
                  <img src="/mascot.svg" alt="Loud" width={64} height={52} />
                </span>
                <h1>Loud</h1>
                <p>Версия {version}</p>
                <UpdateSettings />
                <div className="prefs-about-line" />
                <small>Ваша медиатека и настройки сохраняются локально.</small>
                <small>GPLv3 · © 2026 Loud</small>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
