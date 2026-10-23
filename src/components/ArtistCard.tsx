import { Button } from "@animate-ui/react/primitives/buttons/button";
import { useEffect, useRef, useState } from "react";
import { Refresh } from "../icons";
import { invoke } from "@tauri-apps/api/core";
import { type Artist } from "../lib/artists";
import { artistPortrait, forgetPortrait } from "../lib/artistPortrait";

export default function ArtistCard({
  name,
  artist,
  detail,
  onOpen,
  fallbackCover,
}: {
  name: string;
  artist?: Artist;
  detail?: string;
  onOpen: (name: string, artist?: Artist) => void;
  fallbackCover?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const generation = useRef(0);
  const [photo, setPhoto] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => {
    generation.current++;
    let live = true;
    setPhoto(undefined);
    setFailed(false);
    setCoverFailed(false);
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void artistPortrait(name, artist, revision > 0).then((image) => {
          if (live) {
            setPhoto(image);
            setFailed(!image);
          }
        });
      },
      { rootMargin: "200px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      live = false;
      generation.current++;
      observer.disconnect();
    };
  }, [name, artist, revision]);
  const image = photo || (!coverFailed ? fallbackCover : undefined);
  async function imageError() {
    const current = generation.current;
    if (
      photo &&
      "__TAURI_INTERNALS__" in window &&
      photo.startsWith("https://")
    ) {
      try {
        const data = await invoke<{ mime: string; data: string }>(
          "artwork_image",
          { url: photo },
        );
        if (current !== generation.current) return;
        setPhoto(`data:${data.mime};base64,${data.data}`);
        return;
      } catch {}
    }
    if (current !== generation.current) return;
    if (photo) {
      forgetPortrait(name, artist);
      setPhoto(undefined);
      setFailed(true);
    } else setCoverFailed(true);
  }
  return (
    <article className="artist-card artist-profile-card">
      <Button
        className="artist-card-link"
        aria-label={`Открыть артиста ${name}`}
        onClick={() => onOpen(name, artist)}
      >
        <span className="artist-portrait" ref={ref}>
          {image ? (
            <img
              src={image}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => void imageError()}
            />
          ) : (
            <span className="artist-initial" aria-hidden="true">
              {name.trim().slice(0, 1)}
            </span>
          )}
          {!photo && image && (
            <span className="artist-cover-label">Обложка релиза</span>
          )}
        </span>
        <h3>{name}</h3>
        <p>{detail || "Артист"}</p>
      </Button>
      {failed && (
        <Button
          className="artist-photo-retry"
          onClick={() => setRevision((value) => value + 1)}
          aria-label={`Повторить загрузку фото ${name}`}
          title="Фото недоступно. Попробовать ещё раз"
        >
          <Refresh size={14} />
        </Button>
      )}
    </article>
  );
}
