import { Button } from "@animate-ui/react/primitives/buttons/button";
import { memo, useMemo, useState } from "react";
import {
  Waveform,
  Clock,
  Play,
  Heart,
  More,
  Download,
  Queue,
  Minus,
  X,
} from "../icons";
import type { Playlist, Track } from "../lib/library";
import { time } from "../lib/library";
import { prepareLyrics } from "../lib/lyricsPrefetch";
import { prepareAudio, cancelAudioPreparation } from "../lib/extractor";
import ArtistNames from "./ArtistNames";
import IconButton from "./IconButton";
import CheckField from "./CheckField";
import SelectField from "./SelectField";
import useTrackSelection from "../lib/useTrackSelection";
export type BulkTrackAction =
  "favorite" | "unfavorite" | "download" | "queue" | "playlist" | "remove";
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
  playlists?: Playlist[];
  inPlaylist?: boolean;
  onBulk?: (
    action: BulkTrackAction,
    tracks: Track[],
    playlistId?: string,
  ) => Promise<void>;
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
  playlists = [],
  inPlaylist = false,
  onBulk,
}: Props) {
  const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
  const selection = useTrackSelection(list);
  const selectable = !!onBulk && !compact;
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const allLiked =
    selection.selected.length > 0 &&
    selection.selected.every((track) => favoriteIds.has(track.id));
  const run = async (action: BulkTrackAction, playlistId?: string) => {
    if (!onBulk || bulkBusy || !selection.selected.length) return;
    setBulkBusy(true);
    setBulkError("");
    try {
      await onBulk(action, selection.selected, playlistId);
      if (action === "remove") selection.clear();
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : String(error));
    } finally {
      setBulkBusy(false);
    }
  };
  return (
    <div
      className={`track-table ${compact ? "compact" : ""} ${selectable ? "is-selectable" : ""}`}
    >
      {selectable && selection.selected.length > 0 && (
        <div
          className="track-selection-bar"
          role="region"
          aria-label="Действия с выбранными треками"
        >
          <strong role="status">Выбрано: {selection.selected.length}</strong>
          <Button
            className="button button-subtle"
            disabled={bulkBusy}
            onClick={() => void run(allLiked ? "unfavorite" : "favorite")}
          >
            <Heart size={15} />
            {allLiked ? "Убрать лайки" : "В избранное"}
          </Button>
          <Button
            className="button button-subtle"
            disabled={bulkBusy}
            onClick={() => void run("download")}
          >
            <Download size={15} />
            Скачать
          </Button>
          <Button
            className="button button-subtle"
            disabled={bulkBusy}
            onClick={() => void run("queue")}
          >
            <Queue size={15} />В очередь
          </Button>
          {!!playlists.length && (
            <SelectField
              value="choose"
              aria-label="Добавить выбранные треки в плейлист"
              disabled={bulkBusy}
              onValueChange={(id) => {
                if (id !== "choose") void run("playlist", id);
              }}
            >
              <option value="choose" disabled>
                В плейлист…
              </option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </SelectField>
          )}
          {inPlaylist && (
            <Button
              className="button button-subtle"
              disabled={bulkBusy}
              onClick={() => void run("remove")}
            >
              <Minus size={15} />
              Убрать из плейлиста
            </Button>
          )}
          <IconButton
            icon={X}
            label="Снять выделение"
            disabled={bulkBusy}
            onClick={selection.clear}
          />
          {bulkError && (
            <p className="selection-error" role="alert">
              {bulkError}
            </p>
          )}
        </div>
      )}
      <div className="track-table-head">
        <span className="row-leading">
          {selectable && (
            <CheckField
              aria-label="Выбрать все треки"
              disabled={bulkBusy || !list.length}
              checked={
                selection.selected.length === list.length && list.length > 0
                  ? true
                  : selection.selected.length
                    ? "indeterminate"
                    : false
              }
              onCheckedChange={(checked) =>
                checked ? selection.all() : selection.clear()
              }
            />
          )}
          #
        </span>
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
          className={`track-row ${currentId === track.id ? "current" : ""} ${selectable && selection.ids.has(track.id) ? "is-selected" : ""}`}
          key={track.id}
          data-lyrics-track={track.id}
          data-selection-row={selectable ? track.id : undefined}
          tabIndex={selectable ? 0 : undefined}
          onClick={
            selectable && !bulkBusy
              ? (event) => selection.rowClick(event, track.id)
              : undefined
          }
          onClickCapture={
            selectable && !bulkBusy
              ? (event) => selection.capture(event, track.id)
              : undefined
          }
          onKeyDown={
            selectable && !bulkBusy
              ? (event) => selection.keyDown(event, i)
              : undefined
          }
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
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest('[role="checkbox"]'))
              return;
            if (!event.ctrlKey && !event.metaKey && !event.shiftKey)
              playTrack(track, list);
          }}
        >
          <div className="row-leading">
            {selectable && (
              <CheckField
                aria-label={`Выбрать ${track.title}`}
                checked={selection.ids.has(track.id)}
                disabled={bulkBusy}
                onCheckedChange={() =>
                  selection.select(track.id, { ctrlKey: true })
                }
              />
            )}
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
          </div>
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
