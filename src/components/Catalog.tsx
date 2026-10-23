import CheckField from "./CheckField";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { errorMessage } from "../lib/errors";
import { trackArtists } from "../lib/library";
import { useEffect, useState } from "react";
import {
  Download,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Spinner,
  Music,
  Play,
  Plus,
  Search,
  ExternalLink,
} from "../icons";
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
  onFocusSearch,
  onInfo,
  onArtist,
}: {
  onAdd: (tracks: Track[]) => Promise<void>;
  onPlay: (track: Track, list: Track[]) => void;
  onDownload: (track: Track) => Promise<void>;
  saved: Track[];
  downloading: string | null;
  query: string;
  onFocusSearch: () => void;
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
    setPage(1);
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
      {selected && (
        <div className="catalog-toolbar">
          <Button className="text-button" onClick={() => setSelected(null)}>
            <ArrowLeft size={15} /> Все релизы
          </Button>
        </div>
      )}
      {!selected && (
        <div className="catalog-filters">
          <div className="catalog-tabs" aria-label="Вид каталога">
            <Button
              className={mode === "tracks" ? "active" : ""}
              onClick={() => setMode("tracks")}
            >
              Песни
            </Button>
            <Button
              className={mode === "releases" ? "active" : ""}
              onClick={() => setMode("releases")}
            >
              Релизы
            </Button>
          </div>
          {mode === "tracks" && (
            <>
              <label className="catalog-quality">
                <CheckField
                  checked={flacOnly}
                  onCheckedChange={(value) => setFlacOnly(value)}
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
          <Spinner className="spin" size={25} />
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
          <Button
            className="button button-subtle"
            onClick={() => setRevision((n) => n + 1)}
          >
            Повторить
          </Button>
        </div>
      ) : !selected && mode === "tracks" && !term ? (
        <div className="catalog-empty">
          <Search size={30} />
          <h2>Найдите музыку</h2>
          <p>Введите песню, альбом или артиста в поиск сверху.</p>
          <Button className="button button-subtle" onClick={onFocusSearch}>
            Начать поиск
          </Button>
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
                <Button
                  className="text-button"
                  onClick={() => setRevision((n) => n + 1)}
                >
                  Повторить
                </Button>
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
                <Button
                  className="button button-accent"
                  disabled={!songs.length}
                  onClick={() => onPlay(songs[0], songs)}
                >
                  <Play size={14} fill="currentColor" /> Слушать
                </Button>
                <Button
                  className="button button-subtle"
                  disabled={saving || !songs.length}
                  onClick={() => void add(songs)}
                >
                  {saving ? (
                    <Spinner className="spin" size={14} />
                  ) : (
                    <Plus size={14} />
                  )}{" "}
                  Добавить альбом
                </Button>
              </div>
              <div className="catalog-attribution">
                <a
                  href={`https://archive.org/details/${encodeURIComponent(selected.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Источник <ExternalLink size={12} />
                </a>
                <a href={selected.license} target="_blank" rel="noreferrer">
                  Лицензия Creative Commons <ExternalLink size={12} />
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
                    <Button
                      className="catalog-song-play"
                      aria-label={`Слушать ${track.title}`}
                      onClick={() => onPlay(stored || track, songs)}
                    >
                      <span>{i + 1}</span>
                      <Play size={14} fill="currentColor" />
                    </Button>
                    <Button
                      className="catalog-song-title"
                      onClick={() => onPlay(stored || track, songs)}
                    >
                      {track.title}
                      <small>{trackArtists(track).join(", ")}</small>
                    </Button>
                    <span
                      className={`format-label ${track.format === "MP3" ? "format-lossy" : ""}`}
                    >
                      {track.format}
                    </span>
                    <span className="catalog-duration">
                      {time(track.duration)}
                    </span>
                    <Button
                      className="icon-button"
                      aria-label={`Добавить ${track.title} в медиатеку`}
                      disabled={saving || !!stored}
                      onClick={() => void add([track])}
                    >
                      {stored ? <Check size={16} /> : <Plus size={17} />}
                    </Button>
                    <Button
                      className="icon-button"
                      aria-label={`Скачать ${track.title}`}
                      disabled={downloading !== null || stored?.downloaded}
                      onClick={() => void onDownload(stored || track)}
                    >
                      {downloading === track.id ? (
                        <Spinner className="spin" size={16} />
                      ) : stored?.downloaded ? (
                        <Check size={16} />
                      ) : (
                        <Download size={17} />
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="catalog-error">
              <Music size={30} />
              <p>В этом релизе нет доступных для воспроизведения треков.</p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="album-grid library-grid catalog-grid">
            {albums.map((album) => (
              <article className="album-card" key={album.id}>
                <Button
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
                </Button>
                <Button
                  className="album-name"
                  onClick={() => setSelected(album)}
                >
                  {album.title}
                </Button>
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
            <Button
              className="button button-subtle"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={15} /> Назад
            </Button>
            <span>
              Страница {page} · {total.toLocaleString()} релизов
            </span>
            <Button
              className="button button-subtle"
              disabled={page * 15 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Далее <ChevronRight size={15} />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
