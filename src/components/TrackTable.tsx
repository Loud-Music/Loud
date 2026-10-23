import { Button } from "@animate-ui/react/primitives/buttons/button";
import { memo, useMemo } from "react";
import { Waveform, Clock, Play, Heart, More, Download } from "../icons";
import type { Track } from "../lib/library";
import { time } from "../lib/library";
import { prepareLyrics } from "../lib/lyricsPrefetch";
import { prepareAudio, cancelAudioPreparation } from "../lib/extractor";
import ArtistNames from "./ArtistNames";
import IconButton from "./IconButton";
type Props = {
  list: Track[];
  compact?: boolean;
  currentId: string;
  playing: boolean;
  favorites: string[];
  playTrack: (track: Track, list?: Track[]) => void;
  openArtist: (name: string) => void;
  toggleFavorite: (id: string) => void;
  setSelected: (track: Track) => void;
};
export default memo(function TrackTable({
  list,
  compact = false,
  currentId,
  playing,
  favorites,
  playTrack,
  openArtist,
  toggleFavorite,
  setSelected,
}: Props) {
  const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
  return (
    <div className={`track-table ${compact ? "compact" : ""}`}>
      <div className="track-table-head">
        <span>#</span>
        <span>Название</span>
        <span className="album-column">Альбом</span>
        <span className="source-column">Качество</span>
        <span className="duration-column">
          <Clock size={14} />
        </span>
        <span />
      </div>
      {list.map((track, i) => (
        <div
          className={`track-row ${currentId === track.id ? "current" : ""}`}
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
          onDoubleClick={() => playTrack(track, list)}
        >
          <Button
            className="row-index"
            aria-label={`Слушать ${track.title}`}
            onClick={() => playTrack(track, list)}
          >
            {currentId === track.id && playing ? (
              <Waveform size={17} className="playing-wave" />
            ) : (
              <>
                <span>{i + 1}</span>
                <Play size={15} fill="currentColor" />
              </>
            )}
          </Button>
          <div className="track-info">
            <img src={track.cover} alt="" loading="lazy" decoding="async" />
            <span>
              <strong>
                <Button
                  className="track-title-link"
                  onClick={() => playTrack(track, list)}
                >
                  {track.title}
                </Button>
                {track.format && (
                  <span className="inline-format">{track.format}</span>
                )}
                {track.downloaded && (
                  <span
                    className="downloaded-mark"
                    title="Доступно без интернета"
                  >
                    <Download size={12} />
                  </span>
                )}
              </strong>
              <small>
                <ArtistNames track={track} onOpen={openArtist} />
                {!track.src && <em> · Добавьте аудиофайл</em>}
                {track.preview && track.src && <em> · Отрывок</em>}
              </small>
            </span>
          </div>
          <span className="album-column muted">{track.album}</span>
          <span className="source-column">
            <span className="format-label">
              {track.preview ? "Отрывок" : track.format || "Аудио"}
            </span>
          </span>
          <span className="duration-column muted">{time(track.duration)}</span>
          <div className="row-actions">
            <IconButton
              icon={Heart}
              label={`${favoriteIds.has(track.id) ? "Убрать из избранного" : "В избранное"} ${track.title}`}
              active={favoriteIds.has(track.id)}
              className="favorite-button"
              onClick={() => toggleFavorite(track.id)}
            />
            <IconButton
              icon={More}
              label={`Действия с треком ${track.title}`}
              onClick={() => setSelected(track)}
            />
          </div>
        </div>
      ))}
    </div>
  );
});
