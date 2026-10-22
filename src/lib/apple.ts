import type { Track } from "./library";

interface AppleSong {
  id: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    artwork?: { url: string };
    playParams?: { catalogId?: string };
    previews?: { url: string }[];
  };
}
interface MusicInstance {
  authorize(): Promise<string>;
  setQueue(options: { song: string }): Promise<unknown>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  volume: number;
}
interface MusicKitAPI {
  configure(config: {
    developerToken: string;
    app: { name: string; build: string };
  }): Promise<MusicInstance>;
  getInstance(): MusicInstance;
}
declare global {
  interface Window {
    MusicKit?: MusicKitAPI;
  }
}
let scriptPromise: Promise<void> | undefined;
export function developerToken() {
  return String(import.meta.env.VITE_APPLE_MUSIC_DEVELOPER_TOKEN || "").trim();
}
async function loadMusicKit() {
  if (window.MusicKit) return;
  await (scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
    script.async = true;
    const timeout = window.setTimeout(() => {
      scriptPromise = undefined;
      script.remove();
      reject(new Error("Apple Music не отвечает. Попробуйте ещё раз."));
    }, 20000);
    script.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timeout);
      scriptPromise = undefined;
      script.remove();
      reject(
        new Error("Не удалось загрузить Apple Music. Проверьте подключение."),
      );
    };
    document.head.append(script);
  }));
}
export async function connectApple(): Promise<Track[]> {
  const token = developerToken();
  if (!token)
    throw new Error(
      "Подключение MusicKit в этой сборке не настроено. Вы можете импортировать медиатеку Apple Music в формате XML.",
    );
  await loadMusicKit();
  const music = await window.MusicKit!.configure({
    developerToken: token,
    app: { name: "Loud Platform", build: "0.1.0" },
  });
  const userToken = await music.authorize();
  const songs: AppleSong[] = [];
  let next: string | undefined = "/v1/me/library/songs?limit=100";
  while (next) {
    const url = new URL(next, "https://api.music.apple.com");
    if (url.origin !== "https://api.music.apple.com")
      throw new Error("Unexpected Apple Music pagination URL.");
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Music-User-Token": userToken,
      },
    });
    if (!response.ok)
      throw new Error(
        `Apple Music returned ${response.status}. Check your token and subscription.`,
      );
    const page: { data: AppleSong[]; next?: string } = await response.json();
    songs.push(...page.data);
    next = page.next;
  }
  return songs.map((song) => {
    const a = song.attributes || {};
    return {
      id: `musickit-${song.id}`,
      appleId: a.playParams?.catalogId,
      title: a.name || "Untitled",
      artist: a.artistName || "Неизвестный исполнитель",
      album: a.albumName || "Apple Music",
      duration: (a.durationInMillis || 0) / 1000,
      cover:
        a.artwork?.url.replace("{w}", "500").replace("{h}", "500") ||
        "/covers/imported.svg",
      source: "Apple Music",
    };
  });
}
