import { Button } from "@animate-ui/react/primitives/buttons/button";
import { prepareLyrics, useLyricsPrefetch } from "../lib/lyricsPrefetch";
import { cancelAudioPreparation, prepareAudio } from "../lib/extractor";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Spinner,
  Music,
  Play,
  Plus,
  Refresh,
  Shuffle,
  Waveform,
} from "../icons";
import {
  artistKey,
  artistProfile,
  cachedArtistProfile,
  artistReleases,
  isArtist,
  releaseTracks,
  type ArtistRelease,
  type Artist,
} from "../lib/artists";
import { recordingKey, time, type Track } from "../lib/library";
import ArtistCard from "./ArtistCard";
import SelectField from "./SelectField";
import { appleArtistImage } from "../lib/appleCatalog";
import { artistPortrait } from "../lib/artistPortrait";
import LoudArtistProfile from "./LoudArtistProfile";

export default function ArtistProfile({
  name,
  hint,
  saved,
  followed,
  onFollow,
  onPlay,
  onAdd,
  onArtist,
  onAlbum,
  currentId,
  playing,
  favorites,
  onFavorite,
}: {
  name: string;
  hint?: Artist;
  saved: Track[];
  followed: boolean;
  onFollow: () => void;
  onPlay: (track: Track, list: Track[]) => void;
  onAdd: (tracks: Track[]) => Promise<void>;
  onArtist: (name: string, artist?: Artist) => void;
  onAlbum?: (release: ArtistRelease, artist: string) => void;
  currentId: string;
  playing: boolean;
  favorites: string[];
  onFavorite: (track: Track) => Promise<void>;
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
  const [portrait, setPortrait] = useState<string>();
  const [photoFailed, setPhotoFailed] = useState(false);
  const local = saved.filter((track) => isArtist(track, name));
  useEffect(() => {
    let live = true;
    const cached = cachedArtistProfile(name, hint);
    setLoading(!cached);
    setError("");
    setProfile(cached);
    setMoreSongs(false);
    setFilter("all");
    setSelected(undefined);
    void artistProfile(name, revision > 0, hint, saved)
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
  }, [name, hint, revision]);
  useEffect(() => {
    let live = true;
    setPortrait(undefined);
    setPhotoFailed(false);
    if ((profile?.artist || hint)?.catalog === "loud") return;
    void artistPortrait(name, profile?.artist || hint, revision > 0).then(
      (image) => {
        if (live) setPortrait(image);
      },
    );
    return () => {
      live = false;
    };
  }, [name, hint, profile?.artist.id, profile?.artist.catalog, revision]);
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
  const songs = profile?.songs.length ? profile.songs : local;
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
  const cover = !photoFailed
    ? artist?.picture_xl || artist?.picture_big || portrait
    : undefined;
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
            <Button
              className="artist-song-index"
              aria-label={`Слушать ${track.title}`}
              onClick={() => playList(stored || track, items)}
            >
              <span>
                {currentId === track.id && playing ? (
                  <Waveform size={15} />
                ) : (
                  index + 1
                )}
              </span>
              <Play size={15} fill="currentColor" />
            </Button>
            <img
              src={track.cover}
              alt=""
              loading="lazy"
              onError={(event) => {
                event.currentTarget.src = "/covers/imported.svg";
              }}
            />
            <div className="artist-song-title">
              <Button onClick={() => playList(stored || track, items)}>
                {track.title}
              </Button>
              <Button
                className="artist-text-link"
                aria-label={`Открыть артиста ${track.artist}`}
                onClick={() => onArtist(track.artist)}
              >
                {track.artist}
              </Button>
            </div>
            <span className="artist-song-album">{track.album}</span>
            <span className="artist-song-duration">{time(track.duration)}</span>
            <Button
              className="icon-button"
              aria-label={`Добавить ${track.title} в медиатеку`}
              disabled={!!stored || !!saving}
              onClick={() => void add(track)}
            >
              {saving === track.id ? (
                <Spinner size={16} className="spin" />
              ) : stored ? (
                <Check size={16} />
              ) : (
                <Plus size={16} />
              )}
            </Button>
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
  if (artist?.catalog === "loud" || hint?.catalog === "loud")
    return (
      <LoudArtistProfile
        name={name}
        hint={hint}
        profile={profile}
        loading={loading}
        error={error}
        retry={() => setRevision((value) => value + 1)}
        saved={saved}
        followed={followed}
        onFollow={onFollow}
        onPlay={onPlay}
        onAdd={onAdd}
        onArtist={onArtist}
        onAlbum={onAlbum}
        currentId={currentId}
        playing={playing}
        favorites={favorites}
        onFavorite={onFavorite}
      />
    );
  return (
    <article className="artist-page" aria-label={`Профиль артиста ${name}`}>
      <header className={`artist-hero ${loading ? "is-loading" : ""}`}>
        {cover && (
          <div className="artist-hero-photo">
            <img src={cover} alt={name} onError={() => setPhotoFailed(true)} />
          </div>
        )}
        <div className="artist-hero-copy">
          <span className="artist-eyebrow">Артист</span>
          <h1>{artist?.name || name}</h1>
          <p>
            {local.length
              ? `${local.length} ${local.length % 10 === 1 && local.length % 100 !== 11 ? "трек" : local.length % 10 >= 2 && local.length % 10 <= 4 && !(local.length % 100 >= 12 && local.length % 100 <= 14) ? "трека" : "треков"} в медиатеке`
              : "Музыка и релизы"}
          </p>
        </div>
      </header>
      <div className="artist-actions">
        <Button
          className="button button-accent"
          disabled={!songs.length}
          onClick={() => playList(songs[0], songs)}
        >
          <Play size={17} fill="currentColor" />
          Слушать
        </Button>
        <Button
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
        </Button>
        <Button
          className={`artist-follow ${followed ? "is-followed" : ""}`}
          aria-pressed={followed}
          onClick={onFollow}
        >
          {followed ? <Check size={16} /> : <Plus size={16} />}
          {followed ? "Вы подписаны" : "Подписаться"}
        </Button>
        {(profile?.alternatives?.length || 0) > 1 && (
          <SelectField
            aria-label="Профиль артиста"
            value={profile!.artist.id}
            onValueChange={(value) => {
              const choice = profile?.alternatives?.find(
                (item) => String(item.artist.id) === value,
              );
              if (choice) onArtist(name, choice.artist);
            }}
          >
            {profile!.alternatives!.map((choice) => (
              <option key={choice.artist.id} value={choice.artist.id}>
                {choice.artist.name} · {choice.label}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      {(error || profile?.partial) && (
        <div className="artist-notice" role="status">
          <span>{error || "Часть каталога сейчас недоступна."}</span>
          <Button
            className="text-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            <Refresh size={13} />
            Повторить
          </Button>
        </div>
      )}
      {loading && (
        <div className="artist-loading" role="status">
          <Spinner size={18} className="spin" />
          Загружаем музыку артиста…
        </div>
      )}
      {selected ? (
        <section
          className="artist-release-detail"
          aria-label={`Release ${selected.title}`}
        >
          <Button
            className="artist-back"
            onClick={() => setSelected(undefined)}
          >
            <ArrowLeft size={16} />
            Все релизы
          </Button>
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
              <Button
                className="button button-accent"
                disabled={!albumSongs.length}
                onClick={() => playList(albumSongs[0], albumSongs)}
              >
                <Play size={15} fill="currentColor" />
                Слушать релиз
              </Button>
            </div>
          </header>
          {albumLoading ? (
            <p className="artist-loading" role="status">
              <Spinner size={17} className="spin" />
              Загружаем треки…
            </p>
          ) : albumError ? (
            <div className="artist-notice">
              <span>{albumError}</span>
              <Button
                className="text-button"
                onClick={() => setSelected({ ...selected })}
              >
                Повторить
              </Button>
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
                <Button
                  className="artist-more"
                  onClick={() => setMoreSongs((value) => !value)}
                >
                  {moreSongs ? "Свернуть" : "Показать все"}
                  <ChevronRight size={14} />
                </Button>
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
                    <Button
                      key={value}
                      className={filter === value ? "selected" : ""}
                      aria-pressed={filter === value}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              {filtered.length ? (
                <div className="artist-release-grid">
                  {filtered.map((release) => (
                    <Button
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
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="artist-empty">Релизы пока не найдены.</p>
              )}
              {profile?.more && (
                <Button
                  className="artist-more"
                  disabled={paging}
                  onClick={() => void moreReleases()}
                >
                  {paging ? "Загружаем…" : "Больше релизов"}
                  <ChevronRight size={14} />
                </Button>
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
              <Music size={28} />
              <p>Музыка этого артиста пока не найдена.</p>
            </div>
          )}
        </>
      )}
    </article>
  );
}
