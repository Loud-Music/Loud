import { prepareLyrics, useLyricsPrefetch } from "../lib/lyricsPrefetch";
import { cancelAudioPreparation, prepareAudio } from "../lib/extractor";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  LoaderCircle,
  Music2,
  Play,
  Plus,
  RotateCw,
  Shuffle,
} from "lucide-react";
import {
  artistKey,
  artistProfile,
  artistReleases,
  isArtist,
  releaseTracks,
  type ArtistRelease,
} from "../lib/artists";
import { recordingKey, time, type Track } from "../lib/library";
import ArtistCard from "./ArtistCard";
import { appleArtistImage } from "../lib/appleCatalog";

export default function ArtistProfile({
  name,
  saved,
  followed,
  onFollow,
  onPlay,
  onAdd,
  onArtist,
  onAlbum,
  currentId,
  playing,
}: {
  name: string;
  saved: Track[];
  followed: boolean;
  onFollow: () => void;
  onPlay: (track: Track, list: Track[]) => void;
  onAdd: (tracks: Track[]) => Promise<void>;
  onArtist: (name: string) => void;
  onAlbum?: (release: ArtistRelease, artist: string) => void;
  currentId: string;
  playing: boolean;
}) {
  const [profile, setProfile] =
    useState<Awaited<ReturnType<typeof artistProfile>>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [moreSongs, setMoreSongs] = useState(false);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<ArtistRelease>();
  const [albumSongs, setAlbumSongs] = useState<Track[]>([]);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumError, setAlbumError] = useState("");
  const [saving, setSaving] = useState<string>();
  const [paging, setPaging] = useState(false);
  const local = saved.filter((track) => isArtist(track, name));
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setProfile(undefined);
    void artistProfile(name)
      .then((value) => {
        if (live) {
          setProfile(value);
          if (!value)
            setError(
              "Артист пока не найден в каталоге. Сохранённая музыка доступна ниже.",
            );
        }
      })
      .catch(() => {
        if (live)
          setError(
            "Не удалось загрузить каталог артиста. Проверьте соединение или попробуйте ещё раз.",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [name, revision]);
  useEffect(() => {
    const artist = profile?.artist;
    if (artist?.catalog !== "apple") return;
    let live = true;
    void appleArtistImage(artist.id)
      .then((image) => {
        if (live && image)
          setProfile((current) =>
            current?.artist.id === artist.id
              ? { ...current, artist: { ...current.artist, picture_xl: image } }
              : current,
          );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [profile?.artist.id, profile?.artist.catalog]);
  useEffect(() => {
    let live = true;
    setAlbumSongs([]);
    setAlbumError("");
    if (!selected) {
      setAlbumLoading(false);
      return;
    }
    setAlbumLoading(true);
    void releaseTracks(selected)
      .then((songs) => {
        if (live) setAlbumSongs(songs);
      })
      .catch(() => {
        if (live) setAlbumError("Не удалось загрузить песни этого релиза.");
      })
      .finally(() => {
        if (live) setAlbumLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selected]);
  const artist = profile?.artist;
  const songs = profile?.songs.length
    ? profile.songs
    : local.filter((track) => track.src);
  const localReleases: ArtistRelease[] = [
    ...new Set(local.map((track) => track.album)),
  ].map((album) => ({
    id: `local:${album}`,
    title: album,
    cover_big: local.find((track) => track.album === album)?.cover,
    tracks: local.filter((track) => track.album === album),
  }));
  const releases = profile?.releases.length ? profile.releases : localReleases;
  const filtered = releases
    .filter(
      (release) =>
        filter === "all" ||
        (filter === "album"
          ? release.record_type === "album"
          : ["single", "ep"].includes(release.record_type || "")),
    )
    .sort((a, b) => (b.release_date || "").localeCompare(a.release_date || ""));
  useLyricsPrefetch(
    albumSongs.length
      ? albumSongs
      : profile?.songs?.length
        ? profile.songs
        : local,
  );
  const cover = artist?.picture_xl || artist?.picture_big;
  const playList = (track: Track, items: Track[]) => {
    const resolved = items.map(
      (item) =>
        saved.find((stored) => recordingKey(stored) === recordingKey(item)) ||
        item,
    );
    onPlay(
      resolved.find((item) => recordingKey(item) === recordingKey(track)) ||
        track,
      resolved,
    );
  };
  const add = async (track: Track) => {
    setSaving(track.id);
    try {
      await onAdd([track]);
    } catch {
      setError("Не удалось сохранить трек в медиатеку.");
    } finally {
      setSaving(undefined);
    }
  };
  const list = (items: Track[]) => (
    <div className="artist-song-list">
      {items.map((track, index) => {
        const stored = saved.find(
          (item) => recordingKey(item) === recordingKey(track),
        );
        return (
          <div
            key={track.id}
            data-lyrics-track={track.id}
            onMouseEnter={() => {
              prepareLyrics(track, true);
              prepareAudio(track);
            }}
            onMouseLeave={cancelAudioPreparation}
            onFocus={() => {
              prepareLyrics(track, true);
              prepareAudio(track);
            }}
            onBlur={cancelAudioPreparation}
            className={`artist-song ${currentId === track.id ? "is-current" : ""}`}
          >
            <button
              className="artist-song-index"
              aria-label={`Слушать ${track.title}`}
              onClick={() => playList(stored || track, items)}
            >
              <span>{currentId === track.id && playing ? "♫" : index + 1}</span>
              <Play size={15} fill="currentColor" />
            </button>
            <img
              src={track.cover}
              alt=""
              loading="lazy"
              onError={(event) => {
                event.currentTarget.src = "/covers/imported.svg";
              }}
            />
            <div className="artist-song-title">
              <button onClick={() => playList(stored || track, items)}>
                {track.title}
              </button>
              <button
                className="artist-text-link"
                aria-label={`Открыть артиста ${track.artist}`}
                onClick={() => onArtist(track.artist)}
              >
                {track.artist}
              </button>
            </div>
            <span className="artist-song-album">{track.album}</span>
            <span className="artist-song-duration">{time(track.duration)}</span>
            <button
              className="icon-button"
              aria-label={`Добавить ${track.title} в медиатеку`}
              disabled={!!stored || !!saving}
              onClick={() => void add(track)}
            >
              {saving === track.id ? (
                <LoaderCircle size={16} className="spin" />
              ) : stored ? (
                <Check size={16} />
              ) : (
                <Plus size={16} />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
  const moreReleases = async () => {
    if (!profile || paging) return;
    setPaging(true);
    try {
      const result = await artistReleases(
        profile.artist.id,
        profile.releases.length,
      );
      setProfile((old) =>
        old
          ? {
              ...old,
              releases: [
                ...new Map(
                  [...old.releases, ...result.releases].map((release) => [
                    release.id,
                    release,
                  ]),
                ).values(),
              ],
              more: result.more,
            }
          : old,
      );
    } catch {
      setError("Не удалось загрузить остальные релизы.");
    } finally {
      setPaging(false);
    }
  };
  return (
    <article className="artist-page" aria-label={`Artist profile ${name}`}>
      <header className={`artist-hero ${loading ? "is-loading" : ""}`}>
        {cover && (
          <div className="artist-hero-photo">
            <img
              src={cover}
              alt={name}
              onError={(event) => {
                event.currentTarget.style.opacity = "0";
              }}
            />
          </div>
        )}
        <div className="artist-hero-copy">
          <span className="artist-eyebrow">Артист</span>
          <h1>{artist?.name || name}</h1>
          <p>
            {local.length
              ? `${local.length} ${local.length === 1 ? "трек" : "треков"} в медиатеке`
              : "Музыка и релизы"}
          </p>
        </div>
      </header>
      <div className="artist-actions">
        <button
          className="button button-accent"
          disabled={!songs.length}
          onClick={() => playList(songs[0], songs)}
        >
          <Play size={17} fill="currentColor" />
          Слушать
        </button>
        <button
          className="button button-subtle"
          disabled={!songs.length}
          onClick={() => {
            const shuffled = [...songs];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            playList(shuffled[0], shuffled);
          }}
        >
          <Shuffle size={17} />
          Перемешать
        </button>
        <button
          className={`artist-follow ${followed ? "is-followed" : ""}`}
          aria-pressed={followed}
          onClick={onFollow}
        >
          {followed ? <Check size={16} /> : <Plus size={16} />}
          {followed ? "Вы подписаны" : "Подписаться"}
        </button>
      </div>
      {(error || profile?.partial) && (
        <div className="artist-notice" role="status">
          <span>{error || "Часть каталога сейчас недоступна."}</span>
          <button
            className="text-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RotateCw size={13} />
            Повторить
          </button>
        </div>
      )}
      {loading && (
        <div className="artist-loading" role="status">
          <LoaderCircle size={18} className="spin" />
          Загружаем музыку артиста…
        </div>
      )}
      {selected ? (
        <section
          className="artist-release-detail"
          aria-label={`Release ${selected.title}`}
        >
          <button
            className="artist-back"
            onClick={() => setSelected(undefined)}
          >
            <ArrowLeft size={16} />
            Все релизы
          </button>
          <header>
            <img
              src={
                selected.cover_big ||
                selected.cover_medium ||
                "/covers/imported.svg"
              }
              alt=""
            />
            <div>
              <span className="artist-eyebrow">
                {selected.record_type === "album"
                  ? "Альбом"
                  : selected.record_type === "ep"
                    ? "EP"
                    : "Релиз"}
              </span>
              <h2>{selected.title}</h2>
              <p>
                {name}
                {selected.release_date
                  ? ` · ${selected.release_date.slice(0, 4)}`
                  : ""}
              </p>
              <button
                className="button button-accent"
                disabled={!albumSongs.length}
                onClick={() => playList(albumSongs[0], albumSongs)}
              >
                <Play size={15} fill="currentColor" />
                Слушать релиз
              </button>
            </div>
          </header>
          {albumLoading ? (
            <p className="artist-loading" role="status">
              <LoaderCircle size={17} className="spin" />
              Загружаем треки…
            </p>
          ) : albumError ? (
            <div className="artist-notice">
              <span>{albumError}</span>
              <button
                className="text-button"
                onClick={() => setSelected({ ...selected })}
              >
                Повторить
              </button>
            </div>
          ) : albumSongs.length ? (
            list(albumSongs)
          ) : (
            <p className="artist-empty">Треки этого релиза пока недоступны.</p>
          )}
        </section>
      ) : (
        <>
          {!!songs.length && (
            <section aria-label="Популярные треки">
              <div className="artist-section-heading">
                <h2>
                  {profile?.songs.length ? "Популярные треки" : "В медиатеке"}
                </h2>
              </div>
              {list(moreSongs ? songs : songs.slice(0, 5))}
              {songs.length > 5 && (
                <button
                  className="artist-more"
                  onClick={() => setMoreSongs((value) => !value)}
                >
                  {moreSongs ? "Свернуть" : "Показать все"}
                  <ChevronRight size={14} />
                </button>
              )}
            </section>
          )}
          {!loading && (
            <section aria-label="Дискография">
              <div className="artist-section-heading">
                <h2>Релизы</h2>
                <div className="artist-release-filters">
                  {[
                    ["all", "Все"],
                    ["album", "Альбомы"],
                    ["single", "Синглы и EP"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "selected" : ""}
                      aria-pressed={filter === value}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {filtered.length ? (
                <div className="artist-release-grid">
                  {filtered.map((release) => (
                    <button
                      className="artist-release-card"
                      key={release.id}
                      aria-label={`Открыть релиз ${release.title}`}
                      onClick={() =>
                        onAlbum ? onAlbum(release, name) : setSelected(release)
                      }
                    >
                      <div>
                        <img
                          src={
                            release.cover_big ||
                            release.cover_medium ||
                            "/covers/imported.svg"
                          }
                          alt=""
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.src = "/covers/imported.svg";
                          }}
                        />
                        <span>
                          <ChevronRight size={20} />
                        </span>
                      </div>
                      <strong>{release.title}</strong>
                      <small>
                        {[
                          release.release_date?.slice(0, 4),
                          release.record_type === "album"
                            ? "Альбом"
                            : release.record_type === "ep"
                              ? "EP"
                              : release.record_type === "single"
                                ? "Сингл"
                                : undefined,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="artist-empty">Релизы пока не найдены.</p>
              )}
              {profile?.more && (
                <button
                  className="artist-more"
                  disabled={paging}
                  onClick={() => void moreReleases()}
                >
                  {paging ? "Загружаем…" : "Больше релизов"}
                  <ChevronRight size={14} />
                </button>
              )}
            </section>
          )}
          {!!profile?.related.length && (
            <section aria-label="Похожие артисты">
              <div className="artist-section-heading">
                <h2>Вам также понравится</h2>
              </div>
              <div className="artist-grid artist-related">
                {profile.related
                  .filter((item) => artistKey(item.name) !== artistKey(name))
                  .map((item) => (
                    <ArtistCard
                      key={item.id}
                      name={item.name}
                      artist={item}
                      onOpen={onArtist}
                    />
                  ))}
              </div>
            </section>
          )}
          {!loading && !songs.length && !releases.length && (
            <div className="artist-empty">
              <Music2 size={28} />
              <p>Музыка этого артиста пока не найдена.</p>
            </div>
          )}
        </>
      )}
    </article>
  );
}
