import { Fragment } from "react";
import { trackArtists } from "../lib/library";
import { prepareLyrics, useLyricsPrefetch } from "../lib/lyricsPrefetch";
import { cancelAudioPreparation, prepareAudio } from "../lib/extractor";
import { useEffect, useState } from "react";
import { Play, LoaderCircle, RotateCw, Shuffle } from "lucide-react";
import { loadAlbum, type AlbumSeed } from "../lib/albums";
import { recordingKey, time, type Track } from "../lib/library";

export default function AlbumPage({
  seed,
  saved,
  onPlay,
  onArtist,
  currentId,
  playing,
}: {
  seed: AlbumSeed;
  saved: Track[];
  onPlay: (track: Track, list: Track[]) => void;
  onArtist: (name: string) => void;
  currentId: string;
  playing: boolean;
}) {
  const [album, setAlbum] = useState<Awaited<ReturnType<typeof loadAlbum>>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setAlbum(undefined);
    void loadAlbum(seed, saved)
      .then((value) => {
        if (live) setAlbum(value);
      })
      .catch((reason) => {
        if (live)
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить альбом",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [seed.id, seed.title, seed.artistName, revision]);
  const details = album || seed;
  const songs = album?.tracks || [];
  useLyricsPrefetch(songs);
  const play = (index = 0, shuffle = false) => {
    const items = songs.map((song) => {
      const existing = saved.find(
        (item) =>
          recordingKey(item) === recordingKey(song) &&
          Math.abs(item.duration - song.duration) < 3,
      );
      return existing
        ? { ...existing, artist: song.artist, artists: song.artists }
        : song;
    });
    if (shuffle)
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    if (items[index]) onPlay(items[index], items);
  };
  return (
    <article className="album-page" aria-label={`Release ${details.title}`}>
      <header className="album-hero">
        <img
          className="album-artwork"
          src={
            details.cover_big || details.cover_medium || "/covers/imported.svg"
          }
          alt={`Обложка ${details.title}`}
          onError={(event) => {
            event.currentTarget.src = "/covers/imported.svg";
          }}
        />
        <div className="album-copy">
          <span className="artist-eyebrow">
            {details.record_type === "single"
              ? "Сингл"
              : details.record_type === "ep"
                ? "EP"
                : "Альбом"}
          </span>
          <h1>{details.title}</h1>
          <div className="album-artist-name">
            {(album?.artistNames || [seed.artistName]).map((name, index) => (
              <Fragment key={name}>
                {index > 0 && ", "}
                <button
                  className="artist-text-link"
                  onClick={() => onArtist(name)}
                >
                  {name}
                </button>
              </Fragment>
            ))}
          </div>
          <p>
            {details.release_date?.slice(0, 4)}
            {songs.length
              ? ` · ${songs.length} треков · ${time(songs.reduce((sum, song) => sum + song.duration, 0))}`
              : ""}
          </p>
          <div className="artist-actions">
            <button
              className="button button-accent"
              disabled={!songs.length || loading}
              onClick={() => play()}
            >
              <Play size={17} fill="currentColor" />
              Слушать весь альбом
            </button>
            <button
              className="button button-subtle"
              aria-label="Перемешать альбом"
              disabled={!songs.length || loading}
              onClick={() => play(0, true)}
            >
              <Shuffle size={17} />
            </button>
          </div>
        </div>
      </header>
      {loading && (
        <div className="artist-loading" role="status">
          <LoaderCircle className="spin" size={18} />
          Загружаем полный треклист…
        </div>
      )}
      {error && (
        <div className="artist-notice" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RotateCw size={14} />
            Повторить
          </button>
        </div>
      )}
      <div className="album-tracklist">
        {songs.map((song, index) => (
          <div
            key={`${song.id}:${index}`}
            data-lyrics-track={song.id}
            onMouseEnter={() => {
              prepareLyrics(song, true);
              prepareAudio(song);
            }}
            onMouseLeave={cancelAudioPreparation}
            onFocus={() => {
              prepareLyrics(song, true);
              prepareAudio(song);
            }}
            onBlur={cancelAudioPreparation}
          >
            {song.discNumber &&
            song.discNumber !== songs[index - 1]?.discNumber &&
            songs.some((item) => (item.discNumber || 1) > 1) ? (
              <h3>Диск {song.discNumber}</h3>
            ) : null}
            <button
              className={`album-track ${currentId === song.id ? "is-current" : ""}`}
              aria-label={`Слушать ${song.title}`}
              onClick={() => play(index)}
            >
              <span className="album-track-number">
                {currentId === song.id && playing
                  ? "♫"
                  : song.trackNumber || index + 1}
              </span>
              <span>
                <strong>{song.title}</strong>
                <small>{trackArtists(song).join(", ")}</small>
              </span>
              <time>{time(song.duration)}</time>
              <Play size={14} />
            </button>
          </div>
        ))}
      </div>
      {album?.local && (
        <p className="album-footnote">Песни из вашей медиатеки</p>
      )}
      {album && "label" in album && album.label ? (
        <p className="album-footnote">{String(album.label)}</p>
      ) : null}
    </article>
  );
}
