import { useState } from "react";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import SelectField from "../components/SelectField";
import { ArrowRight, Plus, X } from "../icons";
import { api, type Artist, type Release, type ReleaseItem } from "./api";
import { Actions, Field, FileField, Toggle } from "./Fields";

const localDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
type Master = { key: string; title: string; audio: string };
export default function ReleaseEditor({
  item,
  artists,
  done,
  openTrack,
}: {
  item?: ReleaseItem;
  artists: Artist[];
  done: () => Promise<void>;
  openTrack: (id: number) => void;
}) {
  const [value, setValue] = useState<Release>(
    item?.release || {
      id: 0,
      title: "",
      artistIds: [],
      trackIds: [],
      cover: "",
      release_date: new Date().toLocaleDateString("en-CA"),
      record_type: "single",
    },
  );
  const [masters, setMasters] = useState<Master[]>([
    { key: crypto.randomUUID(), title: "", audio: "" },
  ]);
  const [scheduled, setScheduled] = useState(!!value.publishAt);
  const [at, setAt] = useState(localDate(value.publishAt));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const fileBusy = (value: boolean) =>
    setUploading((before) => before + (value ? 1 : -1));
  const change = (patch: Partial<Release>) =>
    setValue((before) => ({ ...before, ...patch }));
  const save = async (publish = false) => {
    setError("");
    if (
      !value.title.trim() ||
      !value.cover ||
      !value.artistIds.length ||
      (!item && masters.some((m) => !m.audio || !m.title.trim()))
    ) {
      setError(
        "Укажи название, артиста, обложку и мастер с названием для каждого трека.",
      );
      return;
    }
    if (scheduled && (!at || !Number.isFinite(new Date(at).getTime()))) {
      setError("Выбери дату и время выхода.");
      return;
    }
    if (
      !scheduled &&
      value.release_date > new Date().toLocaleDateString("en-CA")
    ) {
      setError("Для будущей даты включи отложенный выпуск и укажи время.");
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: value.title,
        artistIds: value.artistIds,
        cover: value.cover,
        release_date: value.release_date,
        record_type: value.record_type,
        visibility: value.visibility || "public",
        publishAt: scheduled ? new Date(at).toISOString() : "",
        presave: scheduled && !!value.presave,
      };
      let id = item?.release.id;
      if (id)
        await api(
          `releases/${id}`,
          { ...body, trackIds: value.trackIds },
          "PATCH",
        );
      else {
        const result = await api<{ id: number }>("releases", {
          ...body,
          tracks: masters.map((m) => ({
            title: m.title,
            audio: m.audio,
            artistIds: value.artistIds,
          })),
        });
        id = result.id;
      }
      if (publish) await api(`releases/${id}/publish`, {}, "POST");
      await done();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="studio-editor">
      <div className="studio-editor-heading">
        <div>
          <p>{item ? "Карточка релиза" : "Новый релиз"}</p>
          <h2>{value.title || "Сингл, EP или альбом"}</h2>
        </div>
      </div>
      {error && (
        <p className="studio-error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <Field label="Название релиза">
          <input
            value={value.title}
            maxLength={300}
            onChange={(e) => change({ title: e.target.value })}
          />
        </Field>
        <div className="studio-two">
          <Field label="Тип релиза">
            <SelectField
              value={value.record_type}
              onValueChange={(record_type) => change({ record_type })}
            >
              <option value="single">Сингл</option>
              <option value="ep">EP</option>
              <option value="album">Альбом</option>
            </SelectField>
          </Field>
          <Field label="Дата релиза">
            <input
              type="date"
              value={value.release_date}
              onChange={(e) => {
                change({ release_date: e.target.value });
                if (e.target.value > new Date().toLocaleDateString("en-CA")) {
                  setScheduled(true);
                  setAt(e.target.value + "T00:00");
                }
              }}
            />
          </Field>
        </div>
        <Field label="Исполнители" hint="Первый выбранный артист — основной">
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
        <FileField
          label="Обложка релиза"
          accept="image/png,image/jpeg"
          value={value.cover}
          onChange={(cover) => change({ cover })}
          onError={setError}
          onBusy={fileBusy}
        />
        <div className="studio-section-title">
          <h3>Треклист</h3>
          {!item && (
            <Button
              className="button button-subtle"
              onClick={() =>
                setMasters((before) => [
                  ...before,
                  { key: crypto.randomUUID(), title: "", audio: "" },
                ])
              }
            >
              <Plus size={15} />
              Добавить трек
            </Button>
          )}
        </div>
        {item
          ? value.trackIds.map((id, index) => (
              <div className="studio-master" key={id}>
                <span>{index + 1}</span>
                <strong>{item.tracks.find((t) => t.id === id)?.title}</strong>
                <Button
                  className="button button-subtle"
                  onClick={() => openTrack(id)}
                >
                  Редактировать
                  <ArrowRight size={15} />
                </Button>
                {index > 0 && (
                  <Button
                    className="button button-subtle"
                    onClick={() => {
                      const ids = [...value.trackIds];
                      [ids[index - 1], ids[index]] = [
                        ids[index],
                        ids[index - 1],
                      ];
                      change({ trackIds: ids });
                    }}
                  >
                    Выше
                  </Button>
                )}
              </div>
            ))
          : masters.map((master, index) => (
              <div className="studio-master-editor" key={master.key}>
                <div className="studio-section-title">
                  <strong>Трек {index + 1}</strong>
                  {masters.length > 1 && (
                    <Button
                      className="icon-button"
                      aria-label="Убрать трек из черновика"
                      onClick={() =>
                        setMasters((before) =>
                          before.filter((m) => m.key !== master.key),
                        )
                      }
                    >
                      <X size={16} />
                    </Button>
                  )}
                </div>
                <Field label="Название трека">
                  <input
                    value={master.title}
                    onChange={(e) =>
                      setMasters((before) =>
                        before.map((m) =>
                          m.key === master.key
                            ? { ...m, title: e.target.value }
                            : m,
                        ),
                      )
                    }
                  />
                </Field>
                <FileField
                  label="FLAC-мастер"
                  accept=".flac,audio/flac"
                  value={master.audio}
                  onChange={(audio) =>
                    setMasters((before) =>
                      before.map((m) =>
                        m.key === master.key ? { ...m, audio } : m,
                      ),
                    )
                  }
                  onError={setError}
                  onBusy={fileBusy}
                />
              </div>
            ))}
        <div className="studio-section-title">
          <h3>Публикация</h3>
        </div>
        <Toggle
          label="Выпустить в определённое время"
          checked={scheduled}
          onChange={setScheduled}
        />
        {scheduled && (
          <>
            <Field
              label="Время выхода"
              hint={`Часовой пояс этого ПК: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
            >
              <input
                type="datetime-local"
                value={at}
                onChange={(e) => {
                  setAt(e.target.value);
                  change({ release_date: e.target.value.slice(0, 10) });
                }}
              />
            </Field>
            <Toggle
              label="Показывать пресейв до выхода"
              checked={!!value.presave}
              onChange={(presave) => change({ presave })}
            />
            <p className="studio-meta">
              Обложка и треклист появятся заранее. Прослушивание откроется в
              указанное время.
            </p>
          </>
        )}
        <Field label="Видимость">
          <SelectField
            value={value.visibility || "public"}
            onValueChange={(visibility) => change({ visibility })}
          >
            <option value="public">Виден в каталоге</option>
            <option value="hidden">Скрыт</option>
          </SelectField>
        </Field>
      </fieldset>
      <Actions
        busy={busy || uploading > 0}
        save={
          item?.status !== "draft" && !!item ? () => void save() : undefined
        }
      >
        {(!item || item.status === "draft") && (
          <>
            <Button
              className="button button-accent"
              disabled={busy || uploading > 0}
              onClick={() => void save(true)}
            >
              {scheduled ? "Запланировать выпуск" : "Опубликовать"}
            </Button>
            <Button
              className="button button-subtle"
              disabled={busy || uploading > 0}
              onClick={() => void save()}
            >
              Сохранить черновик
            </Button>
          </>
        )}
      </Actions>
    </section>
  );
}
