import { useEffect, useState } from "react";
import { searchArtists, type Artist } from "../lib/artists";
import ArtistCard from "./ArtistCard";

export default function ArtistSearch({
  query,
  onOpen,
}: {
  query: string;
  onOpen: (name: string, artist?: Artist) => void;
}) {
  const [artists, setArtists] = useState<Artist[]>([]);
  useEffect(() => {
    let live = true;
    setArtists([]);
    void searchArtists(query)
      .then((result) => {
        if (live) setArtists(result.slice(0, 5));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [query]);
  if (!artists.length) return null;
  return (
    <section className="artist-search-results" aria-label="Найденные артисты">
      <h2>Артисты</h2>
      <div className="artist-grid">
        {artists.map((artist) => (
          <ArtistCard
            key={`${artist.catalog || "deezer"}:${artist.id}`}
            name={artist.name}
            artist={artist}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}
