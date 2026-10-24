import type { Artist } from "./artists";

export function artistRoute(name: string, artist?: Artist): `artist:${string}` {
  return `artist:${artist ? JSON.stringify({ name, id: artist.id, catalog: artist.catalog }) : name}`;
}
export function parseArtistRoute(value: string): {
  name: string;
  artist?: Artist;
} {
  try {
    const item = JSON.parse(value);
    if (
      typeof item.name === "string" &&
      Number.isSafeInteger(item.id) &&
      item.id > 0 &&
      (!item.catalog || item.catalog === "apple" || item.catalog === "loud")
    )
      return {
        name: item.name,
        artist: { name: item.name, id: item.id, catalog: item.catalog },
      };
  } catch {}
  return { name: value };
}

export type View =
  | "Listen Now"
  | "Discover"
  | "Моя волна"
  | "Songs"
  | "Albums"
  | "Artists"
  | "Favorites"
  | "Downloads"
  | `playlist:${string}`
  | `album:${string}`
  | `artist:${string}`
  | `source:${string}`;

export type WindowAction = "minimize" | "toggleMaximize" | "close";
const labels: Record<string, string> = {
  "Listen Now": "Главная",
  Discover: "Обзор",
  Songs: "Песни",
  Albums: "Альбомы",
  Artists: "Артисты",
  Favorites: "Избранное",
  Downloads: "Загрузки",
};
export const viewLabel = (view: View) => labels[view] || view;
