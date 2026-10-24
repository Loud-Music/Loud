import { useEffect, useState } from "react";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import {
  SidebarMenuButton,
  SidebarProvider,
  SidebarSurface,
  SidebarTrigger,
} from "../components/ui/sidebar";
import { Disc, Music, Plus, Refresh, Search, Spinner, Users } from "../icons";
import { api, media, statusLabel, type Catalog } from "./api";
import ArtistEditor from "./ArtistEditor";
import ReleaseEditor from "./ReleaseEditor";
import TrackEditor from "./TrackEditor";

type Page = "artists" | "releases" | "tracks";
type Selection = { kind: Page; id: number } | undefined;
const labels = { artists: "Артисты", releases: "Релизы", tracks: "Треки" };
export default function App() {
  const [page, setPage] = useState<Page>("releases");
  const [selection, setSelection] = useState<Selection>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setCatalog(await api<Catalog>("catalog"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const done = async () => {
    await load();
    setSelection(undefined);
  };
  const artists = (catalog?.artists || []).filter((a) => !a.deleted);
  const releases = catalog?.releases || [];
  const tracks = releases.flatMap((item) => item.tracks);
  const artistName = (ids: number[]) =>
    ids
      .map((id) => artists.find((a) => a.id === id)?.name || "Удалённый артист")
      .join(", ");
  const matches = (value: string) =>
    value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const go = (next: Page) => {
    setPage(next);
    setSelection(undefined);
    setQuery("");
  };
  const chosenArtist =
    selection?.kind === "artists"
      ? artists.find((a) => a.id === selection.id)
      : undefined;
  const chosenRelease =
    selection?.kind === "releases"
      ? releases.find((a) => a.release.id === selection.id)
      : undefined;
  const chosenTrack =
    selection?.kind === "tracks"
      ? tracks.find((a) => a.id === selection.id)
      : undefined;
  const amount =
    page === "artists"
      ? artists.length
      : page === "releases"
        ? releases.length
        : tracks.length;
  return (
    <SidebarProvider defaultOpen>
      <div className="studio-shell app-shell">
        <SidebarSurface>
          <a
            className="brand studio-brand"
            href="/"
            aria-label="LOUD — панель дистрибьютора"
          >
            <img src="/loud-logo.svg" width="123" alt="LOUD" />
          </a>
          <p className="studio-workspace">
            CLOUDED.D<span>Дистрибьютор</span>
          </p>
          <nav aria-label="Каталог дистрибьютора">
            {(["releases", "artists", "tracks"] as Page[]).map((next) => {
              const Icon =
                next === "artists" ? Users : next === "tracks" ? Music : Disc;
              return (
                <SidebarMenuButton
                  key={next}
                  label={labels[next]}
                  className="nav-item"
                  active={page === next}
                  onClick={() => go(next)}
                >
                  <Icon size={19} />
                  <span>{labels[next]}</span>
                </SidebarMenuButton>
              );
            })}
          </nav>
          <div className="studio-sidebar-bottom">
            <span>Локальная панель</span>
            <small>Ключ хранится на этом ПК</small>
            <a
              href="https://api.mambo.wtf/health"
              target="_blank"
              rel="noreferrer"
            >
              api.mambo.wtf
            </a>
          </div>
        </SidebarSurface>
        <main className="studio-main">
          <header className="studio-topbar">
            <SidebarTrigger />
            <div>
              <h1>{labels[page]}</h1>
              <span>
                {catalog
                  ? `${amount} в каталоге CLOUDED.D`
                  : "Каталог CLOUDED.D"}
              </span>
            </div>
            <Button
              className="icon-button"
              aria-label="Обновить каталог"
              disabled={loading}
              onClick={() => void load()}
            >
              <Refresh size={18} className={loading ? "spin" : ""} />
            </Button>
            <Button
              className="button button-accent"
              onClick={() => {
                const kind = page === "artists" ? "artists" : "releases";
                setPage(kind);
                setSelection({ kind, id: 0 });
              }}
            >
              <Plus size={16} />
              {page === "artists" ? "Создать артиста" : "Создать релиз"}
            </Button>
          </header>
          {error && (
            <div className="studio-api-error" role="alert">
              <strong>Не удалось обновить каталог</strong>
              <p>{error}</p>
              <Button
                className="button button-subtle"
                onClick={() => void load()}
              >
                Повторить
              </Button>
            </div>
          )}
          <div className={`studio-content${selection ? " has-editor" : ""}`}>
            <section className="studio-list">
              <label className="studio-search">
                <Search size={17} />
                <input
                  aria-label="Поиск в каталоге"
                  placeholder={`Найти ${page === "artists" ? "артиста" : page === "tracks" ? "трек" : "релиз"}`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {loading && !catalog ? (
                <div className="studio-empty" role="status">
                  <Spinner size={22} className="spin" />
                  <h2>Загружаем каталог</h2>
                </div>
              ) : (
                <>
                  {page === "artists" &&
                    artists
                      .filter((a) => matches(a.name))
                      .map((a) => (
                        <Button
                          key={a.id}
                          className={`studio-row${selection?.kind === page && selection.id === a.id ? " is-selected" : ""}`}
                          onClick={() => setSelection({ kind: page, id: a.id })}
                        >
                          <div className="studio-row-art is-round">
                            {a.picture_xl ? (
                              <img src={media(a.picture_xl)} alt="" />
                            ) : (
                              <Users size={23} />
                            )}
                          </div>
                          <div className="studio-row-copy">
                            <strong>{a.name}</strong>
                            <span>{a.description || "Артист LOUD"}</span>
                          </div>
                          <span className="studio-status">
                            {a.banned
                              ? "Заблокирован"
                              : a.visibility === "hidden"
                                ? "Скрыт"
                                : "В каталоге"}
                          </span>
                        </Button>
                      ))}
                  {page === "releases" &&
                    releases
                      .filter((item) =>
                        matches(
                          `${item.release.title} ${artistName(item.release.artistIds)}`,
                        ),
                      )
                      .map((item) => (
                        <Button
                          key={item.release.id}
                          className={`studio-row${selection?.kind === page && selection.id === item.release.id ? " is-selected" : ""}`}
                          onClick={() =>
                            setSelection({ kind: page, id: item.release.id })
                          }
                        >
                          <div className="studio-row-art">
                            <img src={media(item.release.cover)} alt="" />
                          </div>
                          <div className="studio-row-copy">
                            <strong>{item.release.title}</strong>
                            <span>
                              {artistName(item.release.artistIds)} ·{" "}
                              {item.tracks.length} треков
                            </span>
                          </div>
                          <span className="studio-status">
                            {item.release.visibility === "hidden"
                              ? "Скрыт"
                              : statusLabel(item)}
                          </span>
                        </Button>
                      ))}
                  {page === "tracks" &&
                    tracks
                      .filter((t) =>
                        matches(`${t.title} ${artistName(t.artistIds)}`),
                      )
                      .map((t) => (
                        <Button
                          key={t.id}
                          className={`studio-row${selection?.kind === page && selection.id === t.id ? " is-selected" : ""}`}
                          onClick={() => setSelection({ kind: page, id: t.id })}
                        >
                          <div className="studio-row-art">
                            <img
                              src={media(
                                t.cover ||
                                  releases.find(
                                    (item) => item.release.id === t.releaseId,
                                  )?.release.cover,
                              )}
                              alt=""
                            />
                          </div>
                          <div className="studio-row-copy">
                            <strong>{t.title}</strong>
                            <span>
                              {artistName(t.artistIds)} · {t.format}
                              {t.lrc ? " · LRC" : ""}
                            </span>
                          </div>
                          <span className="studio-status">
                            {t.banned
                              ? "Заблокирован"
                              : t.visibility === "hidden"
                                ? "Скрыт"
                                : "В каталоге"}
                          </span>
                        </Button>
                      ))}
                  {!amount && !error && (
                    <div className="studio-empty">
                      <Disc size={38} />
                      <h2>
                        {page === "artists"
                          ? "Здесь будут твои артисты"
                          : page === "tracks"
                            ? "Музыка появится после загрузки"
                            : "Первый релиз начинается здесь"}
                      </h2>
                      <p>
                        {page === "artists"
                          ? "Создай профиль, добавь фото и описание."
                          : "Создай артиста, загрузи FLAC и обложку. Релиз можно выпустить сразу или запланировать."}
                      </p>
                      <Button
                        className="button button-subtle"
                        onClick={() => {
                          const kind =
                            page === "artists" || !artists.length
                              ? "artists"
                              : "releases";
                          setPage(kind);
                          setSelection({ kind, id: 0 });
                        }}
                      >
                        <Plus size={16} />
                        {!artists.length || page === "artists"
                          ? "Создать артиста"
                          : "Создать релиз"}
                      </Button>
                    </div>
                  )}
                  {!!amount &&
                    query &&
                    !(page === "artists"
                      ? artists.some((a) => matches(a.name))
                      : page === "tracks"
                        ? tracks.some((t) =>
                            matches(`${t.title} ${artistName(t.artistIds)}`),
                          )
                        : releases.some((item) =>
                            matches(
                              `${item.release.title} ${artistName(item.release.artistIds)}`,
                            ),
                          )) && (
                      <p className="studio-meta">Ничего не найдено.</p>
                    )}
                </>
              )}
            </section>
            {selection && (
              <aside className="studio-detail">
                <div className="studio-detail-top">
                  <Button
                    className="button button-subtle"
                    onClick={() => setSelection(undefined)}
                  >
                    Закрыть редактор
                  </Button>
                </div>
                {selection.kind === "artists" ? (
                  <ArtistEditor
                    key={`a:${selection.id}`}
                    artist={chosenArtist}
                    done={done}
                  />
                ) : selection.kind === "releases" ? (
                  <ReleaseEditor
                    key={`r:${selection.id}`}
                    item={chosenRelease}
                    artists={artists}
                    done={done}
                    openTrack={(id) => {
                      setPage("tracks");
                      setSelection({ kind: "tracks", id });
                    }}
                  />
                ) : chosenTrack ? (
                  <TrackEditor
                    key={`t:${selection.id}`}
                    track={chosenTrack}
                    artists={artists}
                    done={done}
                  />
                ) : (
                  <p className="studio-meta">Трек не найден.</p>
                )}
              </aside>
            )}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
