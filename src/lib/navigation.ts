export type View =
  | "Listen Now"
  | "Discover"
  | "Моя волна"
  | "Songs"
  | "Albums"
  | "Artists"
  | "Favorites"
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
};
export const viewLabel = (view: View) => labels[view] || view;
