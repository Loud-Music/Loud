import { errorMessage } from "../lib/errors";
import { trackArtists } from "../lib/library";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Music2,
  Play,
  Plus,
  Search,
} from "lucide-react";
import { albumTracks, searchCatalog } from "../lib/catalog";
import type { CatalogAlbum } from "../lib/catalog";
import type { Track } from "../lib/library";
import { time } from "../lib/library";
import { mergeSearch, providers, searchTracks } from "../lib/search";
import type { Provider } from "../lib/search";
import ArtistSearch from "./ArtistSearch";
import SearchResults from "./SearchResults";

export default function Catalog({
  onAdd,
  onPlay,
  onDownload,
  saved,
  downloading,
  query,
  onQueryChange,
  onInfo,
  onArtist,
}: {
  onAdd: (tracks: Track[]) => Promise<void>;
  onPlay: (track: Track, list: Track[]) => void;
  onDownload: (track: Track) => Promise<void>;
  saved: Track[];
  downloading: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onInfo: (track: Track) => void;
  onArtist: (name: string) => void;
}) {
  const [term, setTerm] = useState(query.trim());
  const [page, setPage] = useState(1);
  const [albums, setAlbums] = useState<CatalogAlbum[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<CatalogAlbum | null>(null);
  const [songs, setSongs] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<"tracks" | "releases">("tracks");
  const [flacOnly, setFlacOnly] = useState(false);
  const [unavailable, setUnavailable] = useState<Provider[]>([]);
  useEffect(() => {
    setSelected(null);
    const timer = window.setTimeout(() => setTerm(query.trim()), 500);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setUnavailable([]);
    if (!selected && mode === "tracks" && !term) {
      setSongs([]);
      setLoading(false);
      return () => {
        active = false;
      };
    }
    const local = term
      ? saved.filter((t) =>
          `${t.title} ${t.artist} ${t.album}`
            .toLowerCase()
            .includes(term.toLowerCase()),
        )
      : [];
    if (!selected && mode === "tracks") setSongs(local);
    const receive = (data: { tracks: Track[]; unavailable: Provider[] }) => {
      if (active) {
        setSongs(mergeSearch([...local, ...data.tracks], term));
        setUnavailable(data.unavailable);
      }
    };
    const request = selected
      ? albumTracks(selected).then((data) => {
          if (active) setSongs(data);
        })
      : mode === "tracks"
        ? searchTracks(term, providers, receive).then(receive)
        : searchCatalog(term, page).then((data) => {
            if (active) {
              setAlbums(data.albums);
              setTotal(data.total);
            }
          });
    request
      .catch((e) => {
        if (active) setError(errorMessage(e, "Не удалось загрузить каталог."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [term, page, selected, revision, mode]);
  async function add(list: Track[]) {
    setSaving(true);
    setError("");
    try {
      await onAdd(list);
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить песни."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="catalog">
      <div className="catalog-toolbar">
        {selected ? (
          <button className="text-button" onClick={() => setSelected(null)}>
            <ArrowLeft size={15} /> Все релизы
          </button>
        ) : (
          <form
            className="catalog-search"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setTerm(query.trim());
              setRevision((n) => n + 1);
            }}
          >
            <Search size={16} />
            <input
              aria-label="Поиск в каталоге"
              placeholder={
                mode === "tracks"
                  ? "Песни, артисты или жанры"
                  : "Альбомы и артисты"
              }
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
            />
            <button type="submit">Найти</button>
          </form>
        )}
      </div>
      {!selected && (
        <div className="catalog-filters">
          <div className="catalog-tabs" aria-label="Вид каталога">
            <button
              className={mode === "tracks" ? "active" : ""}
              onClick={() => setMode("tracks")}
            >
              Песни
            </button>
            <button
              className={mode === "releases" ? "active" : ""}
              onClick={() => setMode("releases")}
            >
              Релизы
            </button>
          </div>
          {mode === "tracks" && (
            <>
              <label className="catalog-quality">
                <input
                  type="checkbox"
                  checked={flacOnly}
                  onChange={(e) => setFlacOnly(e.target.checked)}
                />{" "}
                Только FLAC
              </label>
            </>
          )}
          <span className="catalog-preference">Сначала FLAC</span>
        </div>
      )}
      {query.trim() !== term ||
      (loading && (selected || mode === "releases" || !songs.length)) ? (
        <div className="catalog-loading" role="status">
          <LoaderCircle className="spin" size={25} />
          <span>
            {selected || mode === "tracks"
              ? "Поиск музыки…"
              : "Загрузка релизов…"}
          </span>
        </div>
      ) : error ? (
        <div className="catalog-error" role="alert">
          <h2>Не удалось загрузить музыку</h2>
          <p>{error}</p>
          <button
            className="button button-subtle"
            onClick={() => setRevision((n) => n + 1)}
          >
            Повторить
          </button>
        </div>
      ) : !selected && mode === "tracks" && !term ? (
        <div className="catalog-empty">
          <Search size={30} />
          <h2>Найдите музыку</h2>
          <p>Поиск песен, альбомов и артистов.</p>
          <p>Полные записи и концертные выступления.</p>
          <button
            className="button button-subtle"
            onClick={() => setMode("releases")}
          >
            Открыть релизы
          </button>
        </div>
      ) : !selected && mode === "tracks" ? (
        <>
          {loading && (
            <p className="catalog-description" role="status">
              Поиск в остальных источниках…
            </p>
          )}
          {unavailable.length > 0 && (
            <p className="catalog-description" role="status">
              Некоторые музыкальные сервисы временно недоступны.{" "}
              {unavailable.length === providers.length && (
                <button
                  className="text-button"
                  onClick={() => setRevision((n) => n + 1)}
                >
                  Повторить
                </button>
              )}
            </p>
          )}
          <ArtistSearch query={term} onOpen={onArtist} />
          <SearchResults
            songs={songs}
            saved={saved}
            flacOnly={flacOnly}
            saving={saving}
            downloading={downloading}
            onPlay={onPlay}
            onAdd={add}
            onDownload={onDownload}
            onInfo={onInfo}
            onArtist={onArtist}
          />
        </>
      ) : selected ? (
        <>
          <div className="catalog-album-header">
            <img
              src={selected.cover}
              alt={`${selected.title} — обложка`}
              onError={(e) => {
                e.currentTarget.src = "/covers/imported.svg";
              }}
            />
            <div>
              <span className="eyebrow">
                АЛЬБОМ ·{" "}
                {songs.some((t) => t.format === "FLAC") ? "FLAC" : "MP3"}
              </span>
              <h2>{selected.title}</h2>
              <p>{selected.artist}</p>
              <span className="catalog-album-count">{songs.length} треков</span>
              <div className="catalog-album-actions">
                <button
                  className="button button-accent"
                  disabled={!songs.length}
                  onClick={() => onPlay(songs[0], songs)}
                >
                  <Play size={14} fill="currentColor" /> Слушать
                </button>
                <button
                  className="button button-subtle"
                  disabled={saving || !songs.length}
                  onClick={() => void add(songs)}
                >
                  {saving ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Plus size={14} />
                  )}{" "}
                  Добавить альбом
                </button>
              </div>
              <div className="catalog-attribution">
                <a
                  href={`https://archive.org/details/${encodeURIComponent(selected.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Источник ↗
                </a>
                <a href={selected.license} target="_blank" rel="noreferrer">
                  Лицензия Creative Commons ↗
                </a>
              </div>
            </div>
          </div>
          {songs.length ? (
            <div className="catalog-song-list">
              {songs.map((track, i) => {
                const stored = saved.find((t) => t.id === track.id);
                return (
                  <div className="catalog-song" key={track.id}>
                    <button
                      className="catalog-song-play"
                      aria-label={`Слушать ${track.title}`}
                      onClick={() => onPlay(stored || track, songs)}
                    >
                      <span>{i + 1}</span>
                      <Play size={14} fill="currentColor" />
                    </button>
                    <button
                      className="catalog-song-title"
                      onClick={() => onPlay(stored || track, songs)}
                    >
                      {track.title}
                      <small>{trackArtists(track).join(", ")}</small>
                    </button>
                    <span
                      className={`format-label ${track.format === "MP3" ? "format-lossy" : ""}`}
                    >
                      {track.format}
                    </span>
                    <span className="catalog-duration">
                      {time(track.duration)}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`Добавить ${track.title} в медиатеку`}
                      disabled={saving || !!stored}
                      onClick={() => void add([track])}
                    >
                      {stored ? <Check size={16} /> : <Plus size={17} />}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Скачать ${track.title}`}
                      disabled={downloading !== null || stored?.downloaded}
                      onClick={() => void onDownload(stored || track)}
                    >
                      {downloading === track.id ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : stored?.downloaded ? (
                        <Check size={16} />
                      ) : (
                        <ArrowDownToLine size={17} />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="catalog-error">
              <Music2 size={30} />
              <p>В этом релизе нет доступных для воспроизведения треков.</p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="album-grid library-grid catalog-grid">
            {albums.map((album) => (
              <article className="album-card" key={album.id}>
                <button
                  className="catalog-cover"
                  onClick={() => setSelected(album)}
                  aria-label={`Открыть релиз ${album.title}`}
                >
                  <img
                    src={album.cover}
                    alt={`${album.title} — обложка`}
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.src = "/covers/imported.svg";
                    }}
                  />
                  <span className="catalog-flac">АУДИО</span>
                </button>
                <button
                  className="album-name"
                  onClick={() => setSelected(album)}
                >
                  {album.title}
                </button>
                <span className="album-artist">{album.artist}</span>
              </article>
            ))}
          </div>
          {albums.length === 0 && (
            <div className="catalog-error">
              <h2>Релизы не найдены</h2>
              <p>
                Попробуйте имя артиста или жанр: джаз, эмбиент, электроника.
              </p>
            </div>
          )}
          <div className="catalog-pagination">
            <button
              className="button button-subtle"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={15} /> Назад
            </button>
            <span>
              Страница {page} · {total.toLocaleString()} релизов
            </span>
            <button
              className="button button-subtle"
              disabled={page * 15 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Далее <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
