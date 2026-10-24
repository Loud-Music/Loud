import { useState } from "react";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import SelectField from "../components/SelectField";
import Dialog from "../components/Dialog";
import LoudArtistBadge from "../components/LoudArtistBadge";
import { api, media, type Artist } from "./api";
import { Actions, Field, FileField, Toggle } from "./Fields";

export default function ArtistEditor({
  artist,
  done,
}: {
  artist?: Artist;
  done: () => Promise<void>;
}) {
  const [value, setValue] = useState<Artist>(
    artist || { id: 0, name: "", genres: [], links: [] },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const fileBusy = (value: boolean) =>
    setUploading((before) => before + (value ? 1 : -1));
  const [deleting, setDeleting] = useState(false);
  const change = (patch: Partial<Artist>) =>
    setValue((before) => ({ ...before, ...patch }));
  const save = async () => {
    if (!value.name.trim()) {
      setError("Укажи имя артиста.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("artists", {
        ...value,
        genres: value.genres?.map((genre) => genre.trim()).filter(Boolean),
      });
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
          <p>Профиль артиста</p>
          <h2>{value.name || "Новый артист"}</h2>
        </div>
        <LoudArtistBadge />
      </div>
      <div
        className="studio-artist-preview"
        style={
          value.banner
            ? {
                backgroundImage: `linear-gradient(90deg,#141416dd,#14141633),url("${media(value.banner)}")`,
              }
            : undefined
        }
      >
        {value.picture_xl ? (
          <img src={media(value.picture_xl)} alt="Портрет артиста" />
        ) : null}
        <div>
          <strong>{value.name || "Имя артиста"}</strong>
          <p>{value.description || ""}</p>
        </div>
      </div>
      {error && (
        <p className="studio-error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <Field label="Имя артиста">
          <input
            value={value.name}
            maxLength={160}
            onChange={(e) => change({ name: e.target.value })}
          />
        </Field>
        <Field label="Краткое описание">
          <input
            value={value.description || ""}
            maxLength={250}
            onChange={(e) => change({ description: e.target.value })}
          />
        </Field>
        <Field label="Об артисте">
          <textarea
            rows={5}
            value={value.bio || ""}
            maxLength={10000}
            onChange={(e) => change({ bio: e.target.value })}
          />
        </Field>
        <div className="studio-two">
          <FileField
            label="Фото артиста"
            accept="image/png,image/jpeg"
            value={value.picture_xl}
            onChange={(picture_xl) => change({ picture_xl })}
            onError={setError}
            onBusy={fileBusy}
          />
          <FileField
            label="Баннер профиля"
            accept="image/png,image/jpeg"
            value={value.banner}
            onChange={(banner) => change({ banner })}
            onError={setError}
            onBusy={fileBusy}
          />
        </div>
        <Field label="Жанры через запятую">
          <input
            value={(value.genres || []).join(", ")}
            onChange={(e) =>
              change({
                genres: e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .slice(0, 8),
              })
            }
          />
        </Field>
        <Field label="Ссылка артиста" hint="HTTPS-ссылка на соцсеть или сайт">
          <input
            type="url"
            value={value.links?.[0]?.url || ""}
            onChange={(e) =>
              change({
                links: e.target.value
                  ? [{ label: "Сайт артиста", url: e.target.value }]
                  : [],
              })
            }
          />
        </Field>
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
          label="Заблокировать артиста и его музыку"
          checked={!!value.banned}
          onChange={(banned) => change({ banned })}
        />
      </fieldset>
      <Actions busy={busy || uploading > 0} save={() => void save()}>
        {artist && (
          <Button
            className="button studio-danger"
            disabled={busy}
            onClick={() => setDeleting(true)}
          >
            Удалить артиста
          </Button>
        )}
      </Actions>
      {deleting && (
        <Dialog
          title="Удалить артиста?"
          close={() => setDeleting(false)}
          busy={busy}
        >
          <p>
            Профиль и музыка артиста пропадут из публичного каталога. Исходные
            файлы сохранятся на сервере.
          </p>
          <Actions busy={busy}>
            <Button
              className="button button-subtle"
              disabled={busy}
              onClick={() => setDeleting(false)}
            >
              Отмена
            </Button>
            <Button
              className="button studio-danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`artists/${artist!.id}`, undefined, "DELETE");
                  await done();
                } catch (reason) {
                  setError(String(reason));
                  setDeleting(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Удалить
            </Button>
          </Actions>
        </Dialog>
      )}
    </section>
  );
}
