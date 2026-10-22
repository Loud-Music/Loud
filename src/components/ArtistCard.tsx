import { useEffect, useRef, useState } from "react";
import { findArtist, type Artist } from "../lib/artists";

function ArtistPortrait({ name, artist }: { name: string; artist?: Artist }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [resolved, setResolved] = useState(artist);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setResolved(artist);
    setFailed(false);
    if (artist) return;
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void findArtist(name)
          .then((value) => {
            if (live) setResolved(value);
          })
          .catch(() => {});
      },
      { rootMargin: "200px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [name, artist]);
  const image = resolved?.picture_xl || resolved?.picture_big;
  return (
    <span className="artist-portrait" ref={ref}>
      {image && !failed ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="artist-initial" aria-hidden="true">
          {name.trim().slice(0, 1)}
        </span>
      )}
    </span>
  );
}
export default function ArtistCard({
  name,
  artist,
  detail,
  onOpen,
}: {
  name: string;
  artist?: Artist;
  detail?: string;
  onOpen: (name: string) => void;
}) {
  return (
    <button
      className="artist-card artist-profile-card"
      aria-label={`Открыть артиста ${name}`}
      onClick={() => onOpen(name)}
    >
      <ArtistPortrait name={name} artist={artist} />
      <h3>{name}</h3>
      <p>{detail || "Артист"}</p>
    </button>
  );
}
