import { useEffect, useState } from "react";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Heart,
  Play,
  Plus,
  Refresh,
  Shuffle,
  Spinner,
  Waveform,
} from "../icons";
import type { Artist, ArtistCatalog, ArtistRelease } from "../lib/artists";
import { time, type Track } from "../lib/library";
import { cancelAudioPreparation, prepareAudio } from "../lib/extractor";
import { prepareLyrics } from "../lib/lyricsPrefetch";
import LoudArtistBadge from "./LoudArtistBadge";
import ReleaseCountdown from "./ReleaseCountdown";

export default function LoudArtistProfile({
  name,
  hint,
  profile,
  loading,
  error,
  retry,
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
  profile?: ArtistCatalog;
  loading: boolean;
  error: string;
  retry: () => void;
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
  const [tab, setTab] = useState("Обзор");
  const [selected, setSelected] = useState<ArtistRelease>();
  const [failedArtwork, setFailedArtwork] = useState(false);
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState<string>();
  const artist = profile?.artist || hint;
  const identity = artist?.id;
  useEffect(() => {
    setTab("Обзор");
    setSelected(undefined);
    setFailedArtwork(false);
    setActionError("");
  }, [identity]);
  const songs =
    profile?.songs ||
    saved.filter(
      (track) =>
        track.source === "Loud" &&
        identity &&
        track.loudArtistIds?.includes(identity),
    );
  const releases = [...(profile?.releases || [])].sort((a, b) =>
    (b.release_date || "").localeCompare(a.release_date || ""),
  );
  const tracks = selected?.tracks || songs;
  const artwork = !failedArtwork
    ? artist?.banner || artist?.picture_xl
    : undefined;
  const play = (track: Track, list = tracks) =>
    !track.availableAt &&
    onPlay(
      saved.find((item) => item.id === track.id && !item.availableAt) || track,
      list.map(
        (item) =>
          saved.find(
            (stored) => stored.id === item.id && !stored.availableAt,
          ) || item,
      ),
    );
  const changeTab = (value: string) => {
    setTab(value);
    setSelected(undefined);
  };
  const openRelease = (release: ArtistRelease) => {
    setSelected(release);
    setTab("Треки");
  };
  useEffect(() => {
    setSelected((before) =>
      before
        ? profile?.releases.find((item) => item.id === before.id) || before
        : before,
    );
  }, [profile?.releases]);
  const addRelease = async () => {
    if (!selected?.tracks?.length) return;
    setSaving(String(selected.id));
    setActionError("");
    try {
      await onAdd(selected.tracks);
    } catch {
      setActionError("Не удалось сохранить релиз в медиатеку.");
    } finally {
      setSaving(undefined);
    }
  };
  const openLink = async (url: string) => {
    setActionError("");
    try {
      if ("__TAURI_INTERNALS__" in window)
        await invoke("open_artist_link", { url });
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setActionError("Не удалось открыть ссылку артиста.");
    }
  };
  const trackList = (items: Track[]) => (
    <div className="artist-song-list">
      {items.map((track, index) => (
        <div
          key={track.id}
          data-lyrics-track={track.id}
          className={`artist-song ${track.id === currentId ? "is-current" : ""}`}
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
        >
          <Button
            className="artist-song-index"
            aria-label={`Слушать ${track.title}`}
            disabled={!!track.availableAt}
            onClick={() => play(track, items)}
          >
            <span>
              {track.id === currentId && playing ? (
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
            <Button onClick={() => play(track, items)}>{track.title}</Button>
            <div className="loud-song-artists">
              {(track.artists || [track.artist]).map((name, index) => (
                <Button
                  key={`${index}:${name}`}
                  className="artist-text-link"
                  onClick={() =>
                    onArtist(
                      name,
                      track.loudArtistIds?.[index]
                        ? {
                            id: track.loudArtistIds[index],
                            name,
                            catalog: "loud",
                          }
                        : undefined,
                    )
                  }
                >
                  {index > 0 ? ", " : ""}
                  {name}
                </Button>
              ))}
            </div>
          </div>
          <span className="artist-song-album">{track.album}</span>
          <span className="artist-song-duration">{time(track.duration)}</span>
          <Button
            className="icon-button"
            aria-label={`Нравится ${track.title}`}
            aria-pressed={favorites.includes(track.id)}
            onClick={() => void onFavorite(track)}
          >
            <Heart
              size={16}
              fill={favorites.includes(track.id) ? "currentColor" : "none"}
            />
          </Button>
        </div>
      ))}
    </div>
  );
  return (
    <article
      className="artist-page loud-artist-page"
      aria-label={`Профиль артиста ${name}`}
    >
      <header className={`loud-artist-hero${artwork ? " has-artwork" : ""}`}>
        <div className="loud-artist-copy">
          <div className="loud-artist-identity">
            <h1>{artist?.name || name}</h1>
            {profile && <LoudArtistBadge />}
          </div>
          {artist?.description && <p>{artist.description}</p>}
          <div className="loud-artist-actions">
            <Button
              className="button button-accent"
              disabled={!songs.length}
              onClick={() => play(songs[0], songs)}
            >
              <Play size={17} fill="currentColor" />
              Слушать
            </Button>
            <Button
              className="button button-subtle"
              aria-pressed={followed}
              onClick={onFollow}
            >
              {followed ? <Check size={17} /> : <Plus size={17} />}
              {followed ? "Вы подписаны" : "Подписаться"}
            </Button>
          </div>
        </div>
        {artwork && (
          <img
            className="loud-artist-artwork"
            src={artwork}
            alt=""
            onError={() => setFailedArtwork(true)}
          />
        )}
      </header>
      <nav className="loud-artist-tabs" aria-label="Разделы профиля">
        {["Обзор", "Треки", "Релизы", "Об артисте"].map((value) => (
          <Button
            key={value}
            className={value === tab ? "is-selected" : ""}
            aria-pressed={value === tab}
            onClick={() => changeTab(value)}
          >
            {value}
          </Button>
        ))}
        <span>Собственный каталог LOUD</span>
      </nav>
      {(error || actionError) && (
        <div className="artist-notice" role="status">
          <span>{actionError || error}</span>
          {error && (
            <Button className="text-button" onClick={retry}>
              <Refresh size={13} />
              Повторить
            </Button>
          )}
        </div>
      )}
      {loading && (
        <div className="artist-loading" role="status">
          <Spinner size={18} className="spin" />
          Загружаем профиль…
        </div>
      )}
      {tab === "Об артисте" ? (
        <section className="loud-artist-about">
          <h2>Об артисте</h2>
          <p>{artist?.bio || "Артист пока не добавил описание."}</p>
          {!!artist?.genres?.length && (
            <p className="loud-artist-genres">{artist.genres.join(" · ")}</p>
          )}
          {artist?.distributor && (
            <p className="loud-artist-genres">
              Дистрибьютор: {artist.distributor.name}
            </p>
          )}
          {!!artist?.links?.length && (
            <div className="loud-artist-links">
              {artist.links.map((link) => (
                <Button
                  key={link.url}
                  className="button button-subtle"
                  onClick={() => void openLink(link.url)}
                >
                  {link.label}
                  <ArrowRight size={15} />
                </Button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div
          className={`loud-artist-content${tab !== "Обзор" ? " is-single" : ""}`}
        >
          {tab !== "Релизы" && (
            <section>
              <div className="loud-artist-section-heading">
                <h2>{selected?.title || "Треки"}</h2>
                {selected ? (
                  <Button
                    className="text-button"
                    onClick={() => setSelected(undefined)}
                  >
                    <ArrowLeft size={14} />
                    Все треки
                  </Button>
                ) : (
                  <Button
                    className="icon-button"
                    disabled={!songs.length}
                    aria-label="Перемешать треки"
                    onClick={() => {
                      const list = [...songs];
                      for (let i = list.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [list[i], list[j]] = [list[j], list[i]];
                      }
                      if (list.length) play(list[0], list);
                    }}
                  >
                    <Shuffle size={17} />
                  </Button>
                )}
              </div>
              {selected && (
                <ReleaseCountdown
                  at={
                    selected.available === false
                      ? selected.publishAt
                      : undefined
                  }
                  onAvailable={retry}
                />
              )}
              {selected && (
                <div className="loud-release-actions">
                  <Button
                    className="button button-accent"
                    disabled={!tracks.length || selected.available === false}
                    onClick={() => play(tracks[0], tracks)}
                  >
                    <Play size={15} fill="currentColor" />
                    Слушать релиз
                  </Button>
                  <Button
                    className="button button-subtle"
                    disabled={
                      !tracks.length ||
                      !!saving ||
                      tracks.every((track) =>
                        saved.some((item) => item.id === track.id),
                      )
                    }
                    onClick={() => void addRelease()}
                  >
                    {saving ? (
                      <Spinner size={15} className="spin" />
                    ) : (
                      <Plus size={15} />
                    )}
                    {selected.available === false
                      ? "Сохранить пресейв"
                      : "В медиатеку"}
                  </Button>
                  {onAlbum && (
                    <Button
                      className="text-button"
                      onClick={() => onAlbum(selected, artist?.name || name)}
                    >
                      Открыть альбом
                      <ArrowRight size={15} />
                    </Button>
                  )}
                </div>
              )}
              {tracks.length
                ? trackList(tab === "Обзор" ? tracks.slice(0, 5) : tracks)
                : !loading && (
                    <p className="artist-empty">
                      Артист ещё не опубликовал треки.
                    </p>
                  )}
              {tab === "Обзор" && songs.length > 5 && (
                <Button
                  className="artist-more"
                  onClick={() => changeTab("Треки")}
                >
                  Все треки
                  <ArrowRight size={14} />
                </Button>
              )}
            </section>
          )}
          {tab !== "Треки" && (
            <section>
              <div className="loud-artist-section-heading">
                <h2>Релизы</h2>
                {tab === "Обзор" && releases.length > 2 && (
                  <Button
                    className="text-button"
                    onClick={() => changeTab("Релизы")}
                  >
                    Все
                    <ArrowRight size={15} />
                  </Button>
                )}
              </div>
              {releases.length ? (
                <div className="loud-artist-releases">
                  {(tab === "Обзор" ? releases.slice(0, 2) : releases).map(
                    (release) => (
                      <Button
                        className="loud-artist-release"
                        key={release.id}
                        aria-label={`Открыть релиз ${release.title}`}
                        onClick={() => openRelease(release)}
                      >
                        <img
                          src={release.cover_big || "/covers/imported.svg"}
                          alt=""
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.src = "/covers/imported.svg";
                          }}
                        />
                        <strong>{release.title}</strong>
                        <small>
                          {[
                            release.release_date?.slice(0, 4),
                            release.record_type === "album"
                              ? "Альбом"
                              : release.record_type === "ep"
                                ? "EP"
                                : "Сингл",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                        {release.available === false && (
                          <span className="loud-presave-label">
                            Пресейв ·{" "}
                            {release.publishAt
                              ? new Date(release.publishAt).toLocaleDateString(
                                  "ru",
                                )
                              : release.release_date}
                          </span>
                        )}
                      </Button>
                    ),
                  )}
                </div>
              ) : (
                !loading && (
                  <p className="artist-empty">Релизы пока не опубликованы.</p>
                )
              )}
              {tab === "Обзор" && (
                <Button
                  className="loud-artist-about-link"
                  onClick={() => changeTab("Об артисте")}
                >
                  <span>
                    Об артисте<small>История и ссылки</small>
                  </span>
                  <ArrowRight size={18} />
                </Button>
              )}
            </section>
          )}
        </div>
      )}
    </article>
  );
}
