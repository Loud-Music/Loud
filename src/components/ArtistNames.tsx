import { Button } from "@animate-ui/react/primitives/buttons/button";
import { Fragment } from "react";
import { trackArtists, type Track } from "../lib/library";
export default function ArtistNames({
  track,
  onOpen,
}: {
  track: Track;
  onOpen: (name: string) => void;
}) {
  return (
    <>
      {trackArtists(track).map((name, index) => (
        <Fragment key={name}>
          {index > 0 && ", "}
          <Button
            className="artist-text-link"
            aria-label={`Открыть артиста ${name}`}
            onClick={() => onOpen(name)}
          >
            {name}
          </Button>
        </Fragment>
      ))}
    </>
  );
}
