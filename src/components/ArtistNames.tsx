import { Button } from "@animate-ui/react/primitives/buttons/button";
import { Fragment } from "react";
import { trackArtists, type Track } from "../lib/library";
import type { Artist } from "../lib/artists";
export default function ArtistNames({
  track,
  onOpen,
}: {
  track: Track;
  onOpen: (name: string, artist?: Artist) => void;
}) {
  return (
    <>
      {trackArtists(track).map((name, index) => (
        <Fragment key={name}>
          {index > 0 && ", "}
          <Button
            className="artist-text-link"
            aria-label={`Открыть артиста ${name}`}
            onClick={() =>
              onOpen(
                name,
                track.loudArtistIds?.[index]
                  ? { id: track.loudArtistIds[index], name, catalog: "loud" }
                  : undefined,
              )
            }
          >
            {name}
          </Button>
        </Fragment>
      ))}
    </>
  );
}
