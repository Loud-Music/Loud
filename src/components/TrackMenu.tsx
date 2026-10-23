import { Button } from "@animate-ui/react/primitives/buttons/button";
import {
  Download,
  ArrowRight,
  Check,
  ChevronRight,
  Folder,
  Heart,
  Queue,
  Minus,
  Plus,
  Users,
  ExternalLink,
} from "../icons";
import type { Playlist, Track } from "../lib/library";
import { sourceLabel } from "../lib/import";
import Dialog from "./Dialog";

interface Props {
  track: Track;
  busy: boolean;
  downloading: boolean;
  favorite: boolean;
  playlists: Playlist[];
  inPlaylist: boolean;
  close: () => void;
  onFavorite: () => void;
  onArtist: () => void;
  onDownload: () => void;
  onQueue: () => void;
  onLink: () => void;
  onPlaylist: (playlist: Playlist) => void;
  onRemove: () => void;
}

export default function TrackMenu({
  track,
  busy,
  downloading,
  favorite,
  playlists,
  inPlaylist,
  close,
  onFavorite,
  onArtist,
  onDownload,
  onQueue,
  onLink,
  onPlaylist,
  onRemove,
}: Props) {
  return (
    <Dialog title={track.title} close={close} busy={busy}>
      <div className="selected-song">
        <img src={track.cover} alt="" />
        <span>
          <strong>{track.artist}</strong>
          <small>{track.album}</small>
          <small>{sourceLabel(track.source)}</small>
        </span>
      </div>
      <Button autoFocus className="action-row" onClick={onFavorite}>
        <Heart size={19} />
        {favorite ? "Убрать из избранного" : "Добавить в избранное"}
        {favorite && <Check size={17} />}
      </Button>
      <Button className="action-row" onClick={onArtist}>
        <Users size={19} />
        Открыть артиста
        <ChevronRight size={17} />
      </Button>
      {(track.remoteUrl || track.extractorUrl) &&
        track.downloadAllowed !== false && (
          <Button
            className="action-row"
            disabled={downloading || track.downloaded}
            onClick={onDownload}
          >
            <Download size={18} />
            {track.downloaded
              ? `Загружено · ${track.format || "аудио"}`
              : `Скачать оригинал · ${track.format || "аудио"}`}
          </Button>
        )}
      {track.attributionUrl && (
        <div className="track-attribution">
          <a href={track.attributionUrl} target="_blank" rel="noreferrer">
            Оригинальный релиз <ExternalLink size={12} />
          </a>
          {track.license &&
            (/^https?:\/\//.test(track.license) ? (
              <a href={track.license} target="_blank" rel="noreferrer">
                Лицензия <ExternalLink size={12} />
              </a>
            ) : (
              <span>{track.license}</span>
            ))}
        </div>
      )}
      {track.src ? (
        <Button className="action-row" onClick={onQueue}>
          <Queue size={19} />
          Добавить в очередь
          <Plus size={17} />
        </Button>
      ) : (
        <Button className="action-row" onClick={onLink}>
          <Folder size={19} />
          Добавить локальный аудиофайл
          <ArrowRight size={17} />
        </Button>
      )}
      <span className="nav-heading">ДОБАВИТЬ В ПЛЕЙЛИСТ</span>
      {playlists.map((playlist) => (
        <Button
          className="action-row"
          key={playlist.id}
          onClick={() => onPlaylist(playlist)}
        >
          <Queue size={18} />
          {playlist.name}
          {playlist.tracks.includes(track.id) ? (
            <Check size={17} />
          ) : (
            <Plus size={17} />
          )}
        </Button>
      ))}
      {inPlaylist && (
        <Button className="action-row destructive" onClick={onRemove}>
          <Minus size={18} />
          Удалить из плейлиста
        </Button>
      )}
    </Dialog>
  );
}
