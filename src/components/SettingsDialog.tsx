import { Tabs } from "@animate-ui/react/primitives/radix-ui/tabs";
import SelectField from "./SelectField";
import RangeField from "./RangeField";
import { Collapsible } from "@animate-ui/react/primitives/radix-ui/collapsible";
import { Switch } from "@animate-ui/react/primitives/radix-ui/switch";
import ModalFrame from "./ModalFrame";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { version } from "../../package.json";
import Equalizer from "./Equalizer";
import UpdateSettings from "./UpdateSettings";
import type { EqualizerSettings } from "../lib/equalizer";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Waveform,
  Check,
  ChevronRight,
  Folder,
  Info,
  Keyboard,
  Settings,
  Sliders,
  User,
  VolumeHigh,
  X,
} from "../icons";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../lib/library";
import type { OutputStatus } from "../lib/usePlayback";
import { exclusiveAvailable } from "../lib/usePlayback";
import MusicTools from "./MusicTools";
import CacheSettings from "./CacheSettings";
import DiscordSettings from "./DiscordSettings";
import CommunityLinks from "./CommunityLinks";
import "../settings.css";

const sections = [
  { id: "general", name: "Основные", icon: Settings },
  { id: "playback", name: "Воспроизведение", icon: Waveform },
  { id: "files", name: "Файлы", icon: Folder },
  { id: "advanced", name: "Дополнительно", icon: Sliders },
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
  performanceMode,
  onPerformanceMode,
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
  performanceMode: "normal" | "potato";
  onPerformanceMode: (mode: "normal" | "potato") => void;
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
  const panel = useRef<HTMLDivElement>(null);
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
    <ModalFrame
      title="Настройки"
      close={close}
      className="prefs-window"
      backdropClassName="prefs-backdrop"
    >
      {(dismiss) => (
        <Tabs.Root
          className="prefs-window-body"
          ref={panel}
          value={section}
          onValueChange={(value) => setSection(value as Section)}
          orientation="vertical"
        >
          <aside className="prefs-sidebar">
            <div className="prefs-brand">
              <div>
                <img src="/loud-logo.svg" alt="LOUD" width={116} height={36} />
                <small>Настройки</small>
              </div>
            </div>
            <Tabs.List className="prefs-tabs" aria-label="Разделы настроек">
              {sections.map(({ id, name, icon: Icon }) => (
                <Tabs.Trigger
                  value={id}
                  key={id}
                  id={`prefs-tab-${id}`}

                  aria-selected={section === id}
                  aria-controls={`prefs-panel-${id}`}
                  tabIndex={section === id ? 0 : -1}
                  className={section === id ? "is-selected" : ""}
                >
                  <Icon size={17} />
                  <span>{name}</span>
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <div className="prefs-sidebar-account">
              <User size={16} />
              <span>{accountName}</span>
            </div>
          </aside>
          <div className="prefs-main">
            <header className="prefs-header">
              <h2>{active.name}</h2>
              <Button
                className="prefs-close"
                aria-label="Закрыть окно"
                onClick={dismiss}
              >
                <X size={16} />
              </Button>
            </header>
            <div className="prefs-content">
              <Tabs.Content
                id="prefs-panel-general"
                aria-labelledby="prefs-tab-general"
                value="general"
                className="prefs-tab-content"
              >
                <>
                  <Group title="Оформление">
                    <div
                      className="prefs-appearance"
                      role="group"
                      aria-label="Оформление"
                    >
                      {["light", "dark"].map((value) => (
                        <Button
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
                        </Button>
                      ))}
                    </div>
                  </Group>
                  <Group title="Производительность">
                    <Row
                      title="Эффекты интерфейса"
                      description="Potato отключает анимированный фон и визуальные эффекты, чтобы снизить нагрузку на видеокарту и процессор."
                    >
                      <div
                        className="prefs-mode-options"
                        role="group"
                        aria-label="Режим производительности"
                      >
                        <Button
                          className={`prefs-button ${performanceMode === "normal" ? "is-selected" : ""}`}
                          aria-pressed={performanceMode === "normal"}
                          onClick={() => onPerformanceMode("normal")}
                        >
                          Обычный
                        </Button>
                        <Button
                          className={`prefs-button ${performanceMode === "potato" ? "is-selected" : ""}`}
                          aria-pressed={performanceMode === "potato"}
                          onClick={() => onPerformanceMode("potato")}
                        >
                          Potato
                        </Button>
                      </div>
                    </Row>
                  </Group>
                  <Group
                    title="Учётная запись"
                    note="Медиатека и настройки хранятся на этом устройстве."
                  >
                    <Row
                      title={accountName}
                      description="Локальная учётная запись"
                    >
                      <Button
                        className="prefs-button"
                        onClick={onSwitchAccount}
                      >
                        Сменить
                      </Button>
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
              </Tabs.Content>
              <Tabs.Content
                id="prefs-panel-playback"
                aria-labelledby="prefs-tab-playback"
                value="playback"
                className="prefs-tab-content"
              >
                <>
                  <Group
                    title="Переход между песнями"
                    note="Подготовленные треки воспроизводятся непрерывно в системном выводе. Если следующая запись ещё загружается, переход продолжится после её подготовки."
                  >
                    <Row title="Без пауз между треками">
                      <Switch.Root
                        type="button"

                        aria-label="Воспроизведение без пауз"
                        checked={gapless}
                        className="prefs-switch"
                        onCheckedChange={() => onGapless(!gapless)}
                      >
                        <Switch.Thumb />
                      </Switch.Root>
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
                      <SelectField
                        aria-label="Вывод звука"
                        value={preferExclusive ? "exclusive" : "system"}
                        onValueChange={(value) =>
                          onExclusive(value === "exclusive")
                        }
                      >
                        <option value="system">Системный</option>
                        <option
                          value="exclusive"
                          disabled={!exclusiveAvailable()}
                        >
                          WASAPI Exclusive
                        </option>
                      </SelectField>
                    </Row>
                    <Row
                      title="Эксклюзивный режим"
                      description="FLAC воспроизводится с исходной частотой и разрядностью."
                    >
                      <Switch.Root
                        type="button"

                        aria-label="Эксклюзивный режим"
                        checked={preferExclusive}
                        disabled={!exclusiveAvailable()}
                        className="prefs-switch"
                        onCheckedChange={() => onExclusive(!preferExclusive)}
                      >
                        <Switch.Thumb />
                      </Switch.Root>
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
                      <VolumeHigh size={16} />
                      <RangeField
                        min={0}
                        max={1}
                        step={0.01}
                        value={volume}
                        disabled={exclusive}
                        onValueChange={(value) => onVolume(Number(value))}
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
                      title={
                        output.exclusive ? output.device : "Системный вывод"
                      }
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
              </Tabs.Content>
              <Tabs.Content
                id="prefs-panel-files"
                aria-labelledby="prefs-tab-files"
                value="files"
                className="prefs-tab-content"
              >
                <>
                  <Group title="Медиатека">
                    <Row
                      title="Добавить музыку"
                      description="Аудиофайлы, медиатека Apple Music или плейлист CSV"
                    >
                      <Button className="prefs-button" onClick={onImport}>
                        Импортировать…
                      </Button>
                    </Row>
                    <Row title="Загружено в медиатеку">
                      <span className="prefs-value">
                        {tracks.filter((track) => track.downloaded).length}{" "}
                        треков
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
                      <Button
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
                      </Button>
                    </Row>
                  </Group>
                  {error && (
                    <p className="prefs-error" role="alert">
                      {error}
                    </p>
                  )}
                </>
              </Tabs.Content>
              <Tabs.Content
                id="prefs-panel-advanced"
                aria-labelledby="prefs-tab-advanced"
                value="advanced"
                className="prefs-tab-content"
              >
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
                  <Collapsible.Root
                    className="prefs-disclosure"
                    open={toolsVisible}
                    onOpenChange={setToolsVisible}
                  >
                    <Collapsible.Trigger asChild>
                      <Button aria-expanded={toolsVisible}>
                        <ChevronRight
                          size={14}
                          className={toolsVisible ? "is-open" : ""}
                        />
                        <Keyboard size={16} />
                        Компоненты воспроизведения
                      </Button>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <MusicTools />
                    </Collapsible.Content>
                  </Collapsible.Root>
                </>
              </Tabs.Content>
              <Tabs.Content
                id="prefs-panel-about"
                aria-labelledby="prefs-tab-about"
                value="about"
                className="prefs-tab-content"
              >
                <div className="prefs-about">
                  <img
                    className="prefs-about-logo"
                    src="/loud-logo.svg"
                    alt="LOUD"
                    width={208}
                    height={64}
                  />
                  <p>Версия {version}</p>
                  <UpdateSettings />
                  <CommunityLinks detailed />
                  <div className="prefs-about-line" />
                  <small>
                    Ваша медиатека и настройки сохраняются локально.
                  </small>
                  <small>GPLv3 · © 2026 Loud</small>
                </div>
              </Tabs.Content>
            </div>
          </div>
        </Tabs.Root>
      )}
    </ModalFrame>
  );
}
