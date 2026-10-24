import { useEffect, useState } from "react";
import type { Artist } from "../lib/artists";
import type { Track } from "../lib/library";
import { loudArtists } from "../lib/loudCatalog";
import ArtistCard from "./ArtistCard";

export default function LoudArtistsSection({
  saved,
  onOpen,
}: {
  saved: Track[];
  onOpen: (name: string, artist?: Artist) => void;
}) {
  const [artists, setArtists] = useState<Artist[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      void loudArtists()
        .then((value) => {
          if (live) setArtists(value);
        })
        .catch(() => {});
    load();
    window.addEventListener("online", load);
    return () => {
      live = false;
      window.removeEventListener("online", load);
    };
  }, []);
  const entries = new Map<number, Artist>();
  for (const track of saved) {
    if (track.source !== "Loud") continue;
    track.loudArtistIds?.forEach((id, index) => {
      const name = track.artists?.[index];
      if (name) entries.set(id, { id, name, catalog: "loud" });
    });
  }
  for (const artist of artists) entries.set(artist.id, artist);
  if (!entries.size) return null;
  return (
    <section className="loud-artists-section" aria-label="Артисты LOUD">
      <h2>Артисты LOUD</h2>
      <div className="artist-grid">
        {[...entries.values()].map((artist) => (
          <ArtistCard
            key={artist.id}
            name={artist.name}
            artist={artist}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}
