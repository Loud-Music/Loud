import { useState } from "react";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import SelectField from "../components/SelectField";
import { Lyrics, Search, Spinner } from "../icons";
import { api, type Artist, type Track } from "./api";
import PreviewAudio from "./PreviewAudio";
import { Actions, Field, FileField, Toggle } from "./Fields";

export default function TrackEditor({
  track,
  artists,
  done,
}: {
  track: Track;
  artists: Artist[];
  done: () => Promise<void>;
}) {
  const [value, setValue] = useState(track);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const fileBusy = (value: boolean) =>
    setUploading((before) => before + (value ? 1 : -1));
  const [detecting, setDetecting] = useState(false);
  const change = (patch: Partial<Track>) =>
    setValue((before) => ({ ...before, ...patch }));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api(
        `tracks/${track.id}`,
        {
          title: value.title,
          artistIds: value.artistIds,
          audio: value.audio,
          cover: value.cover || "",
          visibility: value.visibility || "public",
          banned: !!value.banned,
          lrc: value.lrc || "",
          lyricsSource: value.lyricsSource || "uploaded",
        },
        "PATCH",
      );
      await done();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const detect = async () => {
    setDetecting(true);
    setError("");
    setMessage("");
    try {
      const response = await api<{
        data: { syncedLyrics: string; artistName: string; trackName: string }[];
        source: string;
      }>(`tracks/${track.id}/lyrics/detect`, {}, "POST");
      if (response.data[0]) {
        change({
          lrc: response.data[0].syncedLyrics,
          lyricsSource: response.source,
        });
        setMessage(
          "Найден текст с совпадающим названием, артистом и длительностью. Проверь и сохрани.",
        );
      } else
        setMessage(
          "Точный синхронизированный текст не найден. Можно загрузить свой LRC.",
        );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDetecting(false);
    }
  };
  return (
    <section className="studio-editor">
      <div className="studio-editor-heading">
        <div>
          <p>Карточка трека</p>
          <h2>{value.title}</h2>
        </div>
        <Lyrics size={26} />
      </div>
      <PreviewAudio key={value.audio} path={value.audio} onError={setError} />
      <p className="studio-meta">
        {track.format} ·{" "}
        {track.sampleRate ? `${track.sampleRate / 1000} кГц · ` : ""}
        {Math.floor(track.duration / 60)}:
        {String(Math.floor(track.duration % 60)).padStart(2, "0")}
      </p>
      {error && (
        <p className="studio-error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <Field label="Название">
          <input
            value={value.title}
            maxLength={300}
            onChange={(e) => change({ title: e.target.value })}
          />
        </Field>
        <Field label="Исполнители" hint="Можно выбрать несколько артистов">
          {" "}
          <div className="studio-artists-picker">
            {artists
              .filter((a) => !a.deleted)
              .map((a) => (
                <label key={a.id}>
                  <input
                    type="checkbox"
                    checked={value.artistIds.includes(a.id)}
                    onChange={(e) =>
                      change({
                        artistIds: e.target.checked
                          ? [...value.artistIds, a.id]
                          : value.artistIds.filter((id) => id !== a.id),
                      })
                    }
                  />
                  {a.name}
                </label>
              ))}
          </div>
        </Field>
        <div className="studio-two">
          <FileField
            label="FLAC-мастер"
            accept=".flac,audio/flac"
            value={value.audio}
            onChange={(audio) => change({ audio })}
            onError={setError}
            onBusy={fileBusy}
          />
          <FileField
            label="Обложка трека"
            accept="image/png,image/jpeg"
            value={value.cover}
            onChange={(cover) => change({ cover })}
            onError={setError}
            onBusy={fileBusy}
          />
        </div>
        <Field label="Видимость">
          <SelectField
            value={value.visibility || "public"}
            onValueChange={(visibility) => change({ visibility })}
          >
            <option value="public">Виден в каталоге</option>
            <option value="hidden">Скрыт</option>
          </SelectField>
        </Field>
        <Toggle
          label="Заблокировать трек"
          checked={!!value.banned}
          onChange={(banned) => change({ banned })}
        />
        <div className="studio-section-title">
          <h3>Текст песни</h3>
          <Button
            className="button button-subtle"
            disabled={detecting}
            onClick={() => void detect()}
          >
            {detecting ? (
              <Spinner size={15} className="spin" />
            ) : (
              <Search size={15} />
            )}
            Найти LRC
          </Button>
        </div>
        <Field
          label="Синхронизированный текст"
          hint="Формат: [00:12.50] Строка песни"
        >
          <textarea
            rows={12}
            value={value.lrc || ""}
            maxLength={200000}
            spellCheck={false}
            onChange={(e) =>
              change({ lrc: e.target.value, lyricsSource: "uploaded" })
            }
          />
        </Field>
        <div className="studio-inline">
          <label className="button button-subtle">
            Загрузить .lrc
            <input
              type="file"
              accept=".lrc,text/plain"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 200000) {
                  setError("LRC должен быть меньше 200 КБ.");
                  return;
                }
                change({ lrc: await file.text(), lyricsSource: "uploaded" });
                e.target.value = "";
              }}
            />
          </label>
          <Button
            className="button button-subtle"
            disabled={!value.lrc}
            onClick={() => change({ lrc: "", lyricsSource: "" })}
          >
            Убрать LRC
          </Button>
        </div>
        {message && (
          <p className="studio-meta" role="status">
            {message}
          </p>
        )}
      </fieldset>
      <Actions
        busy={busy || detecting || uploading > 0}
        save={() => void save()}
      />
    </section>
  );
}
