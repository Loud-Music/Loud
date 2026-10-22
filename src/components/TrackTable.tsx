import { AudioLines, Clock3, Play, Heart, Ellipsis } from "lucide-react";
import type { Track } from "../lib/library";
import { time } from "../lib/library";
import { prepareLyrics } from "../lib/lyricsPrefetch";
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
export default function TrackTable({
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
  return (
    <div className={`track-table ${compact ? "compact" : ""}`}>
      <div className="track-table-head">
        <span>#</span>
        <span>Название</span>
        <span className="album-column">Альбом</span>
        <span className="source-column">Качество</span>
        <span className="duration-column">
          <Clock3 size={14} />
        </span>
        <span />
      </div>
      {list.map((track, i) => (
        <div
          className={`track-row ${currentId === track.id ? "current" : ""}`}
          key={track.id}
          data-lyrics-track={track.id}
          onMouseEnter={() => prepareLyrics(track, true)}
          onFocus={() => prepareLyrics(track, true)}
          onDoubleClick={() => playTrack(track, list)}
        >
          <button
            className="row-index"
            aria-label={`Слушать ${track.title}`}
            onClick={() => playTrack(track, list)}
          >
            {currentId === track.id && playing ? (
              <AudioLines size={17} className="playing-wave" />
            ) : (
              <>
                <span>{i + 1}</span>
                <Play size={15} fill="currentColor" />
              </>
            )}
          </button>
          <div className="track-info">
            <img src={track.cover} alt="" />
            <span>
              <strong>
                <button
                  className="track-title-link"
                  onClick={() => playTrack(track, list)}
                >
                  {track.title}
                </button>
                {track.format && (
                  <span className="inline-format">{track.format}</span>
                )}
                {track.downloaded && (
                  <span
                    className="downloaded-mark"
                    title="Доступно без интернета"
                  >
                    ↓
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
              label={`${favorites.includes(track.id) ? "Убрать из избранного" : "В избранное"} ${track.title}`}
              active={favorites.includes(track.id)}
              className="favorite-button"
              onClick={() => toggleFavorite(track.id)}
            />
            <IconButton
              icon={Ellipsis}
              label={`Действия с треком ${track.title}`}
              onClick={() => setSelected(track)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
