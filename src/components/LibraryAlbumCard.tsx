import { Play } from "lucide-react";
import type { Track } from "../lib/library";
type Props = {
  track: Track;
  index: number;
  tracks: Track[];
  openAlbum: (track: Track) => void;
  playTrack: (track: Track, list?: Track[]) => void;
  openArtist: (name: string) => void;
};
export default function LibraryAlbumCard({
  track,
  index,
  tracks,
  openAlbum,
  playTrack,
  openArtist,
}: Props) {
  return (
    <article
      className="album-card"
      key={track.album}
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="cover-wrap">
        <button
          className="cover-link"
          onClick={() => openAlbum(track)}
          aria-label={`Открыть ${track.album}`}
        >
          <img
            src={track.cover}
            alt={`${track.album} — обложка`}
            loading="lazy"
          />
        </button>
        <button
          className="cover-play"
          aria-label={`Слушать ${track.album}`}
          onClick={() =>
            playTrack(
              track,
              tracks.filter((t) => t.album === track.album),
            )
          }
        >
          <Play size={21} fill="currentColor" />
        </button>
      </div>
      <button className="album-name" onClick={() => openAlbum(track)}>
        {track.album}
      </button>
      <button
        className="album-artist artist-text-link"
        onClick={() => openArtist(track.artist)}
      >
        {track.artist}
      </button>
    </article>
  );
}
