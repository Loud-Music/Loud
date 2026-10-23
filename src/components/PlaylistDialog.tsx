import { Button } from "@animate-ui/react/primitives/buttons/button";
import type { FormEvent } from "react";
import { Plus } from "../icons";
import Dialog from "./Dialog";
type Props = {
  busy: boolean;
  playlistName: string;
  close: () => void;
  onName: (name: string) => void;
  onSubmit: (event: FormEvent) => void;
};
export default function PlaylistDialog({
  busy,
  playlistName,
  close,
  onName,
  onSubmit,
}: Props) {
  return (
    <Dialog title={"Новый плейлист"} close={close} busy={busy}>
      <form onSubmit={onSubmit}>
        <p className="dialog-description">Введите название плейлиста.</p>
        <label className="form-label" htmlFor="playlist-name">
          Название плейлиста
        </label>
        <input
          id="playlist-name"
          className="text-input"
          placeholder="Название плейлиста"
          autoFocus
          maxLength={70}
          value={playlistName}
          onChange={(e) => onName(e.target.value)}
        />
        <Button
          type="submit"
          className="button button-accent full-width"
          disabled={!playlistName.trim()}
        >
          <Plus size={16} /> Создать плейлист
        </Button>
      </form>
    </Dialog>
  );
}
