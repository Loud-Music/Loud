import { Button } from "@animate-ui/react/primitives/buttons/button";
import { prepareLyrics, useLyricsPrefetch } from "../lib/lyricsPrefetch";
import {
  cancelAudioPreparation,
  prefetchAudio,
  prepareAudio,
} from "../lib/extractor";
import { useEffect } from "react";
import { Download, Check, More, Spinner, Music, Play, Plus } from "../icons";
import { time } from "../lib/library";
import type { Track } from "../lib/library";

export default function SearchResults({
  songs,
  saved,
  flacOnly,
  saving,
  downloading,
  onPlay,
  onAdd,
  onDownload,
  onInfo,
  onArtist,
}: {
  songs: Track[];
  saved: Track[];
  flacOnly: boolean;
  saving: boolean;
  downloading: string | null;
  onPlay: (track: Track, list: Track[]) => void;
  onAdd: (tracks: Track[]) => Promise<void>;
  onDownload: (track: Track) => Promise<void>;
  onInfo: (track: Track) => void;
  onArtist: (name: string) => void;
}) {
  const visible = songs.filter(
    (track) => !track.preview && (!flacOnly || track.format === "FLAC"),
  );
  const full = visible.filter((track) => !track.preview);
  useLyricsPrefetch(visible);
  const first = visible[0];
  useEffect(() => {
    if (!first) return;
    const timer = setTimeout(() => prefetchAudio(first), 350);
    return () => clearTimeout(timer);
  }, [first?.id, first?.extractorUrl]);
  function rows(tracks: Track[]) {
    return (
      <div className="catalog-song-list search-song-list">
        {tracks.map((track) => {
          const stored = saved.find((t) => t.id === track.id);
          return (
            <div
              className="catalog-song search-song"
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
            >
              <Button
                className="search-track-cover"
                aria-label={`Слушать ${track.title}`}
                onClick={() => onPlay(stored || track, tracks)}
              >
                <img
                  src={track.cover}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.src = "/covers/imported.svg";
                  }}
                />
                <Play size={16} fill="currentColor" />
              </Button>
              <div className="catalog-song-title">
                <Button
                  className="search-title-link"
                  onClick={() => onPlay(stored || track, tracks)}
                >
                  {track.title}
                </Button>
                <Button
                  className="artist-text-link"
                  aria-label={`Открыть артиста ${track.artist}`}
                  onClick={() => onArtist(track.artist)}
                >
                  {track.artist}
                  {track.source === "Live Music Archive" ? " · Live" : ""}
                </Button>
              </div>
              <span
                className={`format-label ${track.format === "FLAC" ? "" : "format-lossy"}`}
              >
                {track.preview ? "Отрывок" : track.format || "Аудио"}
              </span>
              <span className="search-track-album" title={track.album}>
                {track.album}
              </span>
              <span className="catalog-duration">{time(track.duration)}</span>
              <Button
                className="icon-button"
                aria-label={`Добавить ${track.title} в медиатеку`}
                disabled={saving || !!stored}
                onClick={() => void onAdd([track])}
              >
                {stored ? <Check size={16} /> : <Plus size={17} />}
              </Button>
              <Button
                className="icon-button"
                aria-label={`Скачать ${track.title}`}
                title={
                  track.preview
                    ? "Доступен только отрывок"
                    : track.downloadAllowed === false
                      ? "Только прослушивание"
                      : "Скачать исходный файл"
                }
                disabled={
                  track.preview ||
                  track.downloadAllowed === false ||
                  (!track.remoteUrl && !track.extractorUrl) ||
                  downloading !== null ||
                  stored?.downloaded
                }
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
              <Button
                className="icon-button"
                aria-label={`Сведения о треке ${track.title}`}
                onClick={() => onInfo(stored || track)}
              >
                <More size={17} />
              </Button>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <>
      {full.length > 0 && (
        <section className="search-result-group" aria-label="Полные записи">
          <h2>
            Полные записи <span>{full.length}</span>
          </h2>
          {rows(full)}
        </section>
      )}
      {!visible.length && (
        <div className="catalog-error">
          <Music size={28} />
          <h2>Песни не найдены</h2>
          <p>
            {flacOnly
              ? "FLAC не найден. Попробуйте разрешить MP3."
              : "В каталогах нет подходящей записи. Уточните артиста и название песни."}
          </p>
        </div>
      )}
    </>
  );
}
