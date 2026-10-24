import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { errorMessage } from "./lib/errors";
import {
  Download,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Heart,
  Queue,
  Square,
  Minus,
  Music,
  Play,
  Plus,
  Search,
  Shuffle,
  Users,
  X,
} from "./icons";
import type { ChangeEvent } from "react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AlbumPage from "./components/AlbumPage";
import ArtistCard from "./components/ArtistCard";
import LoudArtistsSection from "./components/LoudArtistsSection";
import ArtistProfile from "./components/ArtistProfile";
import Catalog from "./components/Catalog";
import CommunityNotice from "./components/CommunityNotice";
import DownloadsPage from "./components/DownloadsPage";
import DownloadCollection from "./components/DownloadCollection";
import useOffline from "./lib/useOffline";
import IconButton from "./components/IconButton";
import ImportDialog from "./components/ImportDialog";
import LibraryAlbumCard from "./components/LibraryAlbumCard";
import LyricsPanel from "./components/LyricsPanel";
import { PlaybackSetup, initializeMusicTools } from "./components/MusicTools";
import Player from "./components/Player";
import PlaylistDialog from "./components/PlaylistDialog";
import QueuePanel from "./components/QueuePanel";
import Sidebar from "./components/Sidebar";
import TrackMenu from "./components/TrackMenu";
import TrackTable from "./components/TrackTable";
import Wave from "./components/Wave";
import type { LocalAccount } from "./lib/accounts";
import { albumRoute, parseAlbumRoute } from "./lib/albums";
import { connectApple } from "./lib/apple";
import { artistKey, isArtist, type Artist } from "./lib/artists";
import { prefetchAudio } from "./lib/extractor";
import { importLibrary } from "./lib/import";
import { importSoundCloud } from "./lib/soundcloudImport";
import { flushPersistence } from "./lib/persistence";
import type { Playlist, Track } from "./lib/library";
import {
  readSetting,
  restoreTracks,
  saveSetting,
  storeTracks,
  trackArtists,
} from "./lib/library";
import { loadKaraoke, loadLyrics } from "./lib/lyrics";
import { prepareLyrics, useLyricsPrefetch } from "./lib/lyricsPrefetch";
import type { View } from "./lib/navigation";
import { viewLabel, artistRoute, parseArtistRoute } from "./lib/navigation";
import { mergeSearch } from "./lib/search";
import { useDiscordPresence } from "./lib/useDiscordPresence";
import usePlayback from "./lib/usePlayback";
import useFavorites from "./lib/useFavorites";
import { usePresaves } from "./lib/usePresaves";
import useWave from "./lib/useWave";
const SettingsDialog = lazy(() => import("./components/SettingsDialog"));

const idleTrack: Track = {
  id: "",
  title: "Ничего не играет",
  artist: "",
  album: "",
  cover: "/loud-symbol.svg",
  duration: 0,
  source: "Local",
};

type Modal = "import" | "playlist" | "settings" | null;
export default function App({
  account,
  onSwitchAccount,
}: {
  account: LocalAccount;
  onSwitchAccount: () => void;
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  usePresaves(tracks, setTracks);
  const [view, setView] = useState<View>("Моя волна");
  const wave = useWave(tracks);
  const [waveActive, setWaveActive] = useState(false);
  const waveActiveRef = useRef(waveActive);
  waveActiveRef.current = waveActive;
  const waveSession = useRef(0);
  const refillingWave = useRef(false);
  const pendingWaveNext = useRef(false);
  const listened = useRef({ id: "", seconds: 0, reported: false });
  const [history, setHistory] = useState<View[]>([]);
  const [forward, setForward] = useState<View[]>([]);
  const [search, setSearch] = useState("");
  const [followedArtists, setFollowedArtists] = useState<string[]>(() =>
    readSetting("followedArtists:v1", []),
  );
  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    readSetting<Playlist[]>("playlists", []).filter(
      (p) => !["morning", "focus", "hours"].includes(p.id),
    ),
  );
  const [currentId, setCurrentId] = useState("");
  const [queue, setQueue] = useState<string[]>([]);

  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Track | null>(null);
  const [playlistName, setPlaylistName] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState<string>(() =>
    readSetting("theme:v2", "dark"),
  );
  const [dragging, setDragging] = useState(false);
  const onEnded = useRef<() => void>(() => {});
  const [downloading, setDownloading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => initializeMusicTools(), []);
  const searchInput = useRef<HTMLInputElement>(null);
  const linkTarget = useRef<Track | null>(null);
  const dragDepth = useRef(0);
  const current = tracks.find((t) => t.id === currentId) || idleTrack;
  const gaplessQueue = useMemo(() => {
    const playable = new Set(
      tracks
        .filter((track) => track.src || track.extractorUrl)
        .map((track) => track.id),
    );
    return queue.filter((id) => playable.has(id));
  }, [queue, tracks]);
  const gaplessIndex = gaplessQueue.indexOf(currentId);
  const gaplessNextId = shuffle
    ? undefined
    : gaplessQueue[gaplessIndex + 1] ||
      (repeat && gaplessQueue.length > 1 ? gaplessQueue[0] : undefined);
  const gaplessNext = tracks.find((track) => track.id === gaplessNextId);
  useEffect(() => {
    if (!current.id) return;
    void loadKaraoke(current).catch(() => {});
    void loadLyrics(current).catch(() => {});
  }, [current.id, current.title, current.artist, current.duration]);
  const notify = useCallback((message: string) => setToast(message), []);
  const {
    favorites,
    toggleFavorite,
    recovering: recoveringFavorites,
    missing: missingFavorites,
    retry: retryFavorites,
  } = useFavorites(tracks, selected, setTracks, ready, wave.feedback, notify);

  const {
    audio,
    audioProps,
    audioGraph,
    playbackFormat,
    playing,
    setPlaying,
    progress,
    duration,
    volume,
    setVolume,
    exclusive,
    setExclusive,
    preferExclusive,
    equalizer,
    gapless,
    setGapless,
    timelineOffset,
    setEqualizer,
    output,
    error: playbackError,
    dismissError: dismissPlaybackError,
    loading: audioLoading,
    play,
    pause,
    seek,
    togglePlay,
  } = usePlayback(current, notify, onEnded, gaplessNext);
  useDiscordPresence(current, playing, progress, duration);
  const deferredOffline = useRef(new Map<string, Track>());
  const receiveOffline = useCallback(
    (saved: Track) => {
      if (saved.id === currentId && playing) {
        deferredOffline.current.set(saved.id, saved);
        return;
      }
      setTracks((old) => [
        ...old.filter((track) => track.id !== saved.id),
        saved,
      ]);
    },
    [currentId, playing],
  );
  const offline = useOffline(account.id, ready, audioLoading, receiveOffline);
  useEffect(() => {
    const ready = [...deferredOffline.current.values()].filter(
      (track) => track.id !== currentId || !playing,
    );
    if (!ready.length) return;
    ready.forEach((track) => deferredOffline.current.delete(track.id));
    setTracks((old) => [
      ...old.filter((track) => !ready.some((saved) => saved.id === track.id)),
      ...ready,
    ]);
  }, [currentId, playing]);
  const nextQueueIds = queue
    .slice(
      Math.max(0, queue.indexOf(currentId) + 1),
      Math.max(0, queue.indexOf(currentId) + 1) + 3,
    )
    .join("\n");
  const nextLyricsId = queue[queue.indexOf(currentId) + 1];
  useEffect(() => {
    for (const id of nextQueueIds.split("\n")) {
      const upcoming = tracks.find((item) => item.id === id);
      if (upcoming) prepareLyrics(upcoming, true);
    }
  }, [nextQueueIds]);
  const prepareNextLyrics = !!currentId;
  useEffect(() => {
    if (!prepareNextLyrics || !nextLyricsId) return;
    const next = tracks.find((track) => track.id === nextLyricsId);
    if (!next) return;
    if (playing) prefetchAudio(next);
    void loadKaraoke(next).catch(() => {});
    void loadLyrics(next).catch(() => {});
  }, [nextLyricsId, prepareNextLyrics, playing]);

  useEffect(() => {
    let active = true;
    restoreTracks()
      .then((saved) => {
        if (active)
          setTracks(
            saved.filter(
              (t) =>
                t.source !== "Loud" &&
                (t.source !== "SoundCloud" || !!t.extractorUrl) &&
                !t.preview,
            ),
          );
      })
      .catch(() =>
        notify(
          "Не удалось открыть медиатеку. Проверьте свободное место на диске.",
        ),
      )
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [notify]);
  useEffect(() => {
    saveSetting("playlists", playlists);
  }, [playlists]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveSetting("theme:v2", theme);
    if ("__TAURI_INTERNALS__" in window)
      void import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke<string>("set_window_material", { dark: theme === "dark" }),
        )
        .then((material) => {
          document.documentElement.dataset.material = material;
        })
        .catch(() => {
          document.documentElement.dataset.material = "opaque";
        });
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album,
        artwork: [{ src: new URL(current.cover, location.origin).href }],
      });
    }
  }, [current]);

  const navigate = useCallback(
    (next: View) => {
      setLyricsOpen(false);
      if (view !== next) {
        setHistory((h) => [...h, view]);
        setForward([]);
        setView(next);
      }
      setSearch("");
    },
    [view],
  );
  const playTrack = useCallback(
    (track: Track, list?: Track[]) => {
      if (track.availableAt) {
        notify(
          "Этот трек ещё не вышел. Открой страницу релиза после его выхода.",
        );
        return;
      }
      setWaveActive(false);
      waveSession.current++;
      if (!track.src && !track.extractorUrl) {
        setSelected(track);
        notify("Для воспроизведения добавьте аудиофайл к этой записи.");
        return;
      }
      if (list)
        setQueue(list.filter((t) => t.src || t.extractorUrl).map((t) => t.id));
      if (track.id === currentId) {
        void play();
      } else {
        setCurrentId(track.id);
        setPlaying(true);
      }
    },
    [currentId, play, setPlaying, notify],
  );
  const advance = useCallback(
    (direction: number, resume = false) => {
      if (
        direction > 0 &&
        !resume &&
        listened.current.seconds < 30 &&
        waveActive
      )
        wave.feedback(current, "skip");
      const available = queue.filter((id) =>
        tracks.some((t) => t.id === id && t.src),
      );
      if (!available.length) return;
      if (direction < 0 && progress > 3) {
        seek(0);
        return;
      }
      const index = available.indexOf(currentId);
      const options = available.filter((id) => id !== currentId);
      const next =
        shuffle && options.length
          ? options[Math.floor(Math.random() * options.length)]
          : available[
              (index + direction + available.length) % available.length
            ];
      if (next === currentId) {
        seek(0);
        if (playing || resume) void play();
      } else setCurrentId(next);
    },
    [
      queue,
      tracks,
      currentId,
      shuffle,
      playing,
      progress,
      seek,
      play,
      waveActive,
      wave.feedback,
      current,
    ],
  );
  onEnded.current = () => {
    const index = queue.indexOf(currentId);
    if (waveActive && index >= queue.length - 1) {
      pendingWaveNext.current = true;
      void startWave(true);
      return;
    }
    if (repeat || shuffle || index < queue.length - 1) {
      setPlaying(true);
      advance(1, true);
    } else setPlaying(false);
  };
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const editable = (e.target as HTMLElement)?.closest(
        "input, textarea, select, [contenteditable]",
      );
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInput.current?.focus();
      }
      if (e.code === "Space" && !editable && !modal && !selected) {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) {
        setModal(null);
        setSelected(null);
        setQueueOpen(false);
        setLyricsOpen(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [togglePlay, modal, selected]);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => {
      void play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      void pause();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => advance(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => advance(-1));
    return () => {
      ["play", "pause", "nexttrack", "previoustrack"].forEach((action) =>
        navigator.mediaSession.setActionHandler(
          action as MediaSessionAction,
          null,
        ),
      );
    };
  }, [advance, play, pause]);

  async function handleFiles(files: File[]) {
    if (!files.length || busy || !ready) return;
    setBusy(true);
    let count = 0;
    const errors: string[] = [];
    const target = linkTarget.current;
    linkTarget.current = null;
    try {
      const imported: Awaited<ReturnType<typeof importLibrary>> = [];
      for (const file of files) {
        try {
          imported.push(
            ...(await importLibrary(file)).map((entry) => ({
              ...entry,
              track: { ...entry.track, inLibrary: true },
            })),
          );
        } catch (error) {
          errors.push(
            error instanceof Error
              ? error.message
              : "Не удалось импортировать файлы.",
          );
        }
      }
      if (target) {
        const entry = imported.find((e) => e.blob);
        if (!entry) throw new Error("Выберите аудиофайл для этой песни.");
        const linked = {
          ...target,
          preview: false,
          src: entry.track.src,
          duration: entry.track.duration || target.duration,
        };
        await storeTracks([{ track: linked, blob: entry.blob }]);
        setTracks((old) => old.map((t) => (t.id === target.id ? linked : t)));
        count = 1;
      } else if (imported.length) {
        await storeTracks(imported);
        setTracks((old) => {
          const merged = new Map(old.map((t) => [t.id, t]));
          imported.forEach(({ track }) => merged.set(track.id, track));
          return [...merged.values()];
        });
        count = new Set(imported.map((e) => e.track.id)).size;
      }
      if (count) {
        setModal(null);
        setSelected(null);
        navigate("Songs");
      }
      notify(
        [
          count
            ? `${target ? "Аудиофайл добавлен" : `Импортировано треков: ${count}`}.`
            : "",
          ...errors,
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить импортированные файлы.",
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function addCatalogTracks(items: Track[], announce = true) {
    const merged = items.map((track) => ({
      ...(tracks.find((t) => t.id === track.id && t.downloaded) || track),
      inLibrary: true,
    }));
    await storeTracks(merged.map((track) => ({ track })));
    setTracks((old) => {
      const map = new Map(old.map((t) => [t.id, t]));
      merged.forEach((track) => map.set(track.id, track));
      return [...map.values()];
    });
    if (announce) notify(`Добавлено в медиатеку: ${items.length}.`);
  }
  async function handleSoundCloud(url: string) {
    setBusy(true);
    try {
      const result = await importSoundCloud(url);
      await addCatalogTracks(result.tracks, false);
      if (result.id) {
        const id = result.id;
        const previous = playlists.find((playlist) => playlist.id === id);
        const imported = {
          id,
          name: result.name,
          tracks: [
            ...new Set([
              ...(previous?.tracks || []),
              ...result.tracks.map((track) => track.id),
            ]),
          ],
        };
        const next = [
          ...playlists.filter((playlist) => playlist.id !== id),
          imported,
        ];
        saveSetting("playlists", next);
        await flushPersistence();
        setPlaylists(next);
        navigate(`playlist:${id}`);
      } else navigate("Songs");
      setModal(null);
      notify(
        `Добавлено песен: ${result.tracks.length}.${result.skipped ? ` Недоступно или повторяется: ${result.skipped}.` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }
  function playCatalogTrack(track: Track, list: Track[], waveMode = false) {
    if (track.availableAt) {
      notify("Прослушивание откроется в дату выхода релиза.");
      return;
    }
    const local = (song: Track) =>
      tracks.find((saved) => saved.id === song.id && saved.downloaded) || song;
    track = local(track);
    list = list.map(local);
    setWaveActive(waveMode);
    if (!waveMode) {
      waveSession.current++;
      pendingWaveNext.current = false;
    }
    setTracks((old) => {
      const map = new Map(old.map((t) => [t.id, t]));
      list.forEach((t) => {
        if (!map.has(t.id)) map.set(t.id, t);
      });
      map.set(track.id, track);
      return [...map.values()];
    });
    setQueue(list.map((t) => t.id));
    if (currentId === track.id) void play();
    else {
      setCurrentId(track.id);
      setPlaying(true);
    }
  }
  async function startWave(forceNext = false) {
    if (waveActive && !forceNext) {
      togglePlay();
      return;
    }
    const session = forceNext ? waveSession.current : ++waveSession.current;
    const next = await wave.load(forceNext ? queue : []);
    if (session !== waveSession.current || !next.length) return;
    pendingWaveNext.current = false;
    setShuffle(false);
    setRepeat(false);
    playCatalogTrack(next[0], next, true);
  }
  function dislikeWaveTrack() {
    wave.feedback(current, "dislike");
    advance(1, true);
    setQueue((old) =>
      old.filter(
        (id) =>
          id === currentId ||
          tracks.find((t) => t.id === id)?.album !== current.album,
      ),
    );
  }
  function tuneWave(patch: Parameters<typeof wave.changeProfile>[0]) {
    waveSession.current++;
    wave.changeProfile(patch);
    if (waveActive)
      setQueue((old) => old.slice(0, Math.max(0, old.indexOf(currentId)) + 1));
  }
  useEffect(() => {
    if (
      view === "Моя волна" &&
      !wave.recommendations.length &&
      !wave.loading &&
      !wave.error
    )
      void wave.load();
  }, [view, wave.recommendations.length, wave.loading, wave.error, wave.load]);
  useEffect(() => {
    if (
      !waveActive ||
      wave.loading ||
      wave.error ||
      refillingWave.current ||
      queue.length - queue.indexOf(currentId) - 1 > 2
    )
      return;
    refillingWave.current = true;
    const session = waveSession.current;
    void wave
      .load(queue)
      .then((items) => {
        if (
          !items.length ||
          session !== waveSession.current ||
          !waveActiveRef.current
        )
          return;
        setTracks((old) => {
          const map = new Map(old.map((t) => [t.id, t]));
          items.forEach((t) => {
            if (!map.has(t.id)) map.set(t.id, t);
          });
          return [...map.values()];
        });
        setQueue((old) => [...new Set([...old, ...items.map((t) => t.id)])]);
        if (pendingWaveNext.current) {
          pendingWaveNext.current = false;
          playCatalogTrack(items[0], items, true);
        }
      })
      .finally(() => {
        refillingWave.current = false;
      });
  }, [waveActive, currentId, queue, wave.loading, wave.error, wave.load]);
  useEffect(() => {
    if (listened.current.id !== current.id)
      listened.current = { id: current.id, seconds: 0, reported: false };
    if (!playing) return;
    const timer = setInterval(() => {
      listened.current.seconds++;
      const threshold = Math.min(60, Math.max(15, current.duration * 0.6));
      if (!listened.current.reported && listened.current.seconds >= threshold) {
        listened.current.reported = true;
        wave.feedback(current, "listen");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [current.id, current.duration, playing, wave.feedback]);
  async function saveDownload(track: Track) {
    if (downloading) return;
    setDownloading(track.id);
    try {
      await offline.enqueue(
        {
          id: `track:${track.id}`,
          name: track.title,
          kind: "tracks",
          tracks: [track.id],
        },
        [track],
      );
      notify("Трек добавлен в очередь офлайн-загрузки.");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setDownloading(null);
    }
  }
  async function handleApple() {
    setBusy(true);
    try {
      const imported = (await connectApple()).map((track) => ({
        ...track,
        inLibrary: true,
      }));
      await storeTracks(imported.map((track) => ({ track })));
      setTracks((old) => [
        ...old.filter((t) => !imported.some((i) => i.id === t.id)),
        ...imported,
      ]);
      setModal(null);
      navigate("source:Apple Music");
      notify(
        `Импортировано записей: ${imported.length}. Добавьте аудиофайлы для воспроизведения.`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Не удалось подключиться к Apple Music.",
      );
    } finally {
      setBusy(false);
    }
  }
  function createPlaylist(e: React.FormEvent) {
    e.preventDefault();
    const name = playlistName.trim();
    if (!name) return;
    const playlist = { id: crypto.randomUUID(), name, tracks: [] };
    setPlaylists((old) => [...old, playlist]);
    setPlaylistName("");
    setModal(null);
    navigate(`playlist:${playlist.id}`);
    notify(`Плейлист «${name}» создан.`);
  }
  async function windowAction(action: "minimize" | "toggleMaximize" | "close") {
    if (!("__TAURI_INTERNALS__" in window)) {
      if (action === "toggleMaximize") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
      }
      return;
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()[action]();
  }

  const openArtist = useCallback(
    (name: string, artist?: Artist) => {
      if (name.trim()) {
        setSelected(null);
        navigate(artistRoute(name, artist));
      }
    },
    [navigate],
  );
  const followArtist = (name: string) => {
    setFollowedArtists((old) => {
      const next = old.some((item) => artistKey(item) === artistKey(name))
        ? old.filter((item) => artistKey(item) !== artistKey(name))
        : [...old, name];
      saveSetting("followedArtists:v1", next);
      return next;
    });
  };
  const artistView = view.startsWith("artist:");
  const artistSeed = useMemo(
    () => (artistView ? parseArtistRoute(view.slice(7)) : undefined),
    [view, artistView],
  );
  const albumView = view.startsWith("album:");
  const albumSeed = albumView ? parseAlbumRoute(view.slice(6)) : undefined;
  const openAlbum = (track: Track) =>
    navigate(
      albumRoute({
        id: `local:${track.album}`,
        title: track.album,
        artistName: track.artist,
        cover_big: track.cover,
      }),
    );
  const libraryTracks = useMemo(
    () => tracks.filter((t) => t.inLibrary),
    [tracks],
  );
  const playlist = playlists.find((p) => view === `playlist:${p.id}`);
  const viewTitle =
    albumSeed?.title ||
    artistSeed?.name ||
    playlist?.name ||
    (view.startsWith("album:") ||
    view.startsWith("artist:") ||
    view.startsWith("source:")
      ? view.substring(view.indexOf(":") + 1)
      : viewLabel(view));
  const visible = useMemo(() => {
    let items = playlist
      ? playlist.tracks
          .map((id) => tracks.find((t) => t.id === id))
          .filter((t): t is Track => !!t)
      : view === "Favorites"
        ? tracks.filter((t) => favorites.includes(t.id))
        : view.startsWith("album:")
          ? tracks.filter((t) => t.album === view.slice(6))
          : view.startsWith("artist:")
            ? tracks.filter((t) =>
                isArtist(t, parseArtistRoute(view.slice(7)).name),
              )
            : view.startsWith("source:")
              ? tracks.filter((t) => t.source === view.slice(7))
              : libraryTracks;
    items = items.filter(
      (t) =>
        !search ||
        `${t.title} ${t.artist} ${t.album}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
    return view === "Favorites" || playlist ? items : mergeSearch(items, "");
  }, [playlist, tracks, view, favorites, libraryTracks, search]);
  const albums = useMemo(
    () => [...new Map(visible.map((t) => [t.album, t])).values()],
    [visible],
  );
  const home = view === "Listen Now" && !search;
  const grid = ["Albums", "Discover", "Artists"].includes(view) && !search;
  const artists = useMemo(
    () =>
      [
        ...new Map(
          [...libraryTracks.flatMap(trackArtists), ...followedArtists].map(
            (name) => [artistKey(name), name],
          ),
        ).values(),
      ].sort((a, b) => a.localeCompare(b)),
    [libraryTracks, followedArtists],
  );
  const playable = useMemo(
    () => visible.filter((t) => t.src || t.extractorUrl),
    [visible],
  );
  useEffect(() => {
    if (
      !playlist ||
      !playable[0] ||
      playable[0].downloaded ||
      navigator.onLine === false
    )
      return;
    const timer = window.setTimeout(() => prefetchAudio(playable[0]), 80);
    return () => window.clearTimeout(timer);
  }, [playlist?.id, playable[0]?.id]);
  useLyricsPrefetch(
    wave.recommendations.length && view === "Моя волна"
      ? wave.recommendations
      : visible,
  );

  return (
    <SidebarProvider
      className="app-shell"
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void handleFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <Sidebar
        view={view}
        favorites={favorites}
        downloadCount={offline.pending}
        playlists={playlists}
        account={account}
        onSwitchAccount={onSwitchAccount}
        navigate={navigate}
        setModal={setModal}
      />
      <div className="main-shell">
        <header className="toolbar" data-tauri-drag-region="deep">
          <div className="toolbar-left">
            <SidebarTrigger />
            <IconButton
              icon={ChevronLeft}
              label="Назад"
              disabled={!history.length}
              onClick={() => {
                const prev = history.at(-1)!;
                setForward((f) => [...f, view]);
                setHistory((h) => h.slice(0, -1));
                setView(prev);
                setLyricsOpen(false);
                setSearch("");
              }}
            />
            <IconButton
              icon={ChevronRight}
              label="Вперёд"
              disabled={!forward.length}
              onClick={() => {
                const next = forward.at(-1)!;
                setHistory((h) => [...h, view]);
                setForward((f) => f.slice(0, -1));
                setView(next);
                setLyricsOpen(false);
                setSearch("");
              }}
            />
            <label className="global-search">
              <Search size={16} />
              <input
                ref={searchInput}
                type="search"
                aria-label="Поиск музыки"
                placeholder="Песни, альбомы, артисты"
                value={search}
                onChange={(event) => {
                  setLyricsOpen(false);
                  setView("Discover");
                  setSearch(event.target.value);
                }}
              />
            </label>
          </div>
          <div className="toolbar-right">
            <Button
              className="button button-subtle import-button"
              onClick={() => setModal("import")}
            >
              <Plus size={16} /> Импорт музыки
            </Button>
            <div className="native-controls">
              <IconButton
                icon={Minus}
                label="Свернуть"
                onClick={() => void windowAction("minimize")}
              />
              <IconButton
                icon={Square}
                label="Развернуть"
                onClick={() => void windowAction("toggleMaximize")}
              />
              <IconButton
                icon={X}
                label="Закрыть"
                onClick={() => void windowAction("close")}
              />
            </div>
          </div>
        </header>
        <main
          className={`content ${view === "Моя волна" ? "content-wave" : ""}`}
          key={view}
          hidden={lyricsOpen}
        >
          {!artistView && !albumView && view !== "Моя волна" && (
            <section className="page-heading">
              <div>
                <h1>{search ? `Результаты поиска «${search}»` : viewTitle}</h1>
                {!home && view !== "Discover" && (
                  <p>
                    {view === "Downloads"
                      ? `${offline.pending} в очереди`
                      : view === "Artists"
                        ? `${artists.length} в медиатеке`
                        : `${visible.length} треков${playlist ? " · Плейлист" : ""}`}
                  </p>
                )}
              </div>
            </section>
          )}

          {albumSeed && (
            <AlbumPage
              seed={albumSeed}
              saved={libraryTracks}
              onPlay={playCatalogTrack}
              onArtist={openArtist}
              currentId={currentId}
              playing={playing}
              offlineJobs={offline.jobs}
              onDownload={offline.enqueue}
              openDownloads={() => navigate("Downloads")}
            />
          )}
          {view === "Downloads" && (
            <DownloadsPage
              state={offline}
              progress={offline.progress}
              online={offline.online}
              control={offline.control}
              play={playCatalogTrack}
            />
          )}
          {artistView && (
            <ArtistProfile
              onAlbum={(release, artistName) =>
                navigate(albumRoute({ ...release, artistName }))
              }
              name={artistSeed!.name}
              hint={artistSeed?.artist}
              favorites={favorites}
              onFavorite={(track) => toggleFavorite(track.id, track)}
              saved={libraryTracks}
              followed={followedArtists.some(
                (name) => artistKey(name) === artistKey(artistSeed!.name),
              )}
              onFollow={() => followArtist(artistSeed!.name)}
              onPlay={playCatalogTrack}
              onAdd={addCatalogTracks}
              onArtist={openArtist}
              currentId={currentId}
              playing={playing}
            />
          )}
          {view === "Artists" && (
            <LoudArtistsSection saved={libraryTracks} onOpen={openArtist} />
          )}
          {view === "Artists" &&
            (artists.length ? (
              <div className="artist-grid artist-directory">
                {artists.map((name) => (
                  <ArtistCard
                    key={artistKey(name)}
                    name={name}
                    fallbackCover={
                      libraryTracks.find(
                        (track) =>
                          isArtist(track, name) &&
                          track.cover &&
                          !track.cover.startsWith("/covers/"),
                      )?.cover
                    }
                    detail={
                      followedArtists.some(
                        (item) => artistKey(item) === artistKey(name),
                      )
                        ? "Вы подписаны"
                        : `${libraryTracks.filter((track) => isArtist(track, name)).length} треков в медиатеке`
                    }
                    onOpen={openArtist}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Users size={40} />
                <h2>Ваши артисты</h2>
                <p>
                  Подписывайтесь на артистов или добавляйте их музыку в
                  медиатеку.
                </p>
                <Button
                  className="button button-accent"
                  onClick={() => navigate("Discover")}
                >
                  Найти артиста
                  <ArrowRight size={15} />
                </Button>
              </div>
            ))}
          {view === "Моя волна" && (
            <Wave
              audioGraph={audioGraph}
              exclusive={exclusive}
              nativeLevel={output.level ?? 0}
              nativeBass={output.bass ?? 0}
              onPlay={(track) =>
                playCatalogTrack(track, wave.recommendations, true)
              }
              profile={wave.profile}
              onChange={tuneWave}
              onStart={() => void startWave()}
              onSkip={() => advance(1)}
              onLike={() => toggleFavorite(currentId)}
              onDislike={dislikeWaveTrack}
              current={current}
              active={waveActive}
              playing={playing}
              loading={wave.loading || audioLoading}
              error={wave.error}
              recommendations={wave.recommendations}
              liked={favorites.includes(currentId)}
            />
          )}
          {view === "Discover" && (
            <Catalog
              query={search}
              onFocusSearch={() => searchInput.current?.focus()}
              onInfo={setSelected}
              onArtist={openArtist}
              onAdd={addCatalogTracks}
              onPlay={playCatalogTrack}
              onDownload={saveDownload}
              saved={tracks.filter((t) => t.inLibrary)}
              downloading={downloading}
            />
          )}
          {home && libraryTracks.length === 0 && (
            <section className="catalog-empty">
              <Music size={32} />
              <h2>В медиатеке пока пусто</h2>
              <p>Добавьте найденную музыку или импортируйте аудиофайлы.</p>
              <div className="catalog-album-actions">
                <Button
                  className="button button-accent"
                  onClick={() => navigate("Discover")}
                >
                  Найти музыку
                </Button>
                <Button
                  className="button button-subtle"
                  onClick={() => setModal("import")}
                >
                  Импорт музыки
                </Button>
              </div>
            </section>
          )}
          {home && libraryTracks.length > 0 && (
            <>
              <section className="albums-section">
                <div className="section-heading">
                  <h2>Недавно добавленные</h2>
                  <Button
                    className="text-button"
                    onClick={() => navigate("Albums")}
                  >
                    Показать все <ChevronRight size={14} />
                  </Button>
                </div>
                <div className="album-grid">
                  {[...new Map(libraryTracks.map((t) => [t.album, t])).values()]
                    .slice(-5)
                    .map((track, index) => (
                      <LibraryAlbumCard
                        key={track.album}
                        track={track}
                        index={index}
                        tracks={tracks}
                        openAlbum={openAlbum}
                        playTrack={playTrack}
                        openArtist={openArtist}
                      />
                    ))}
                </div>
              </section>
              <section className="playlist-section">
                <div className="section-heading">
                  <h2>Ваши плейлисты</h2>
                  <Button
                    className="text-button"
                    onClick={() => setModal("playlist")}
                  >
                    <Plus size={14} /> Новый плейлист
                  </Button>
                </div>
                <div className="playlist-cards">
                  {playlists.slice(0, 3).map((p) => {
                    const items = p.tracks
                      .map((id) => tracks.find((t) => t.id === id))
                      .filter((t): t is Track => !!t);
                    return (
                      <article className="playlist-card" key={p.id}>
                        <Button
                          className="playlist-artwork"
                          onClick={() => navigate(`playlist:${p.id}`)}
                          aria-label={`Открыть плейлист ${p.name}`}
                        >
                          {items.length ? (
                            Array.from({ length: 4 }, (_, i) => (
                              <img
                                key={i}
                                src={items[i % items.length].cover}
                                alt=""
                              />
                            ))
                          ) : (
                            <Queue size={45} />
                          )}
                        </Button>
                        <div>
                          <Button
                            className="album-name"
                            onClick={() => navigate(`playlist:${p.id}`)}
                          >
                            {p.name}
                          </Button>
                          <span className="album-artist">
                            {items.length} треков
                          </span>
                        </div>
                        <IconButton
                          icon={Play}
                          label={`Слушать плейлист ${p.name}`}
                          disabled={!items.some((t) => t.src || t.extractorUrl)}
                          onClick={() => {
                            const list = items.filter(
                              (t) => t.src || t.extractorUrl,
                            );
                            if (list[0]) playTrack(list[0], list);
                          }}
                        />
                      </article>
                    );
                  })}
                </div>
              </section>
              <section className="recent-section">
                <div className="section-heading">
                  <h2>Песни</h2>
                  <Button
                    className="text-button"
                    onClick={() => navigate("Songs")}
                  >
                    Показать все <ChevronRight size={14} />
                  </Button>
                </div>
                {
                  <TrackTable
                    list={libraryTracks.slice(-5)}
                    compact
                    currentId={currentId}
                    playing={playing}
                    favorites={favorites}
                    playTrack={playTrack}
                    openArtist={openArtist}
                    toggleFavorite={toggleFavorite}
                    setSelected={setSelected}
                  />
                }
              </section>
            </>
          )}

          {!home &&
            !artistView &&
            !albumView &&
            view !== "Artists" &&
            view !== "Discover" &&
            view !== "Downloads" &&
            view !== "Моя волна" && (
              <>
                {view === "Favorites" && missingFavorites > 0 && (
                  <div className="library-recovery" role="status">
                    <span>
                      {recoveringFavorites
                        ? `Восстанавливаем записи избранного: ${missingFavorites}…`
                        : `Не загружены записи песен: ${missingFavorites}. Лайки сохранены.`}
                    </span>
                    {!recoveringFavorites && (
                      <Button className="text-button" onClick={retryFavorites}>
                        Повторить
                      </Button>
                    )}
                  </div>
                )}
                <div className="library-tools">
                  <div className="library-play-actions">
                    <Button
                      className="button button-accent"
                      disabled={!playable.length}
                      onClick={() => playTrack(playable[0], playable)}
                    >
                      <Play size={14} fill="currentColor" /> Слушать
                      {playlist ? " плейлист" : " всё"}
                    </Button>
                    <Button
                      className="button button-subtle"
                      disabled={!playable.length}
                      onClick={() => {
                        setShuffle(true);
                        playTrack(
                          playable[Math.floor(Math.random() * playable.length)],
                          playable,
                        );
                      }}
                    >
                      <Shuffle size={15} /> Перемешать
                    </Button>
                  </div>
                  {playlist && (
                    <DownloadCollection
                      group={{
                        id: `playlist:${playlist.id}`,
                        name: playlist.name,
                        kind: "playlist",
                        tracks: visible.map((track) => track.id),
                      }}
                      tracks={visible}
                      jobs={offline.jobs}
                      enqueue={offline.enqueue}
                      open={() => navigate("Downloads")}
                    />
                  )}
                  <span className="sort-label">
                    {visible.length} треков <ChevronDown size={13} />
                  </span>
                </div>
                {visible.length === 0 ? (
                  <div className="empty-state">
                    {view === "Favorites" ? (
                      <Heart size={40} />
                    ) : search ? (
                      <Search size={40} />
                    ) : (
                      <Music size={40} />
                    )}
                    <h2>
                      {search
                        ? "Песни не найдены"
                        : view === "Favorites"
                          ? "В избранном пока пусто"
                          : playlist
                            ? "Нет песен"
                            : "Медиатека пуста"}
                    </h2>
                    <p>
                      {search
                        ? "Попробуйте другое название, исполнителя или альбом."
                        : view === "Favorites"
                          ? "Нажмите на сердечко рядом с песней, чтобы добавить её сюда."
                          : playlist
                            ? "Добавьте песню в плейлист через её меню."
                            : "Импортируйте аудиофайлы или медиатеку из другого сервиса."}
                    </p>
                    <Button
                      className="button button-accent"
                      onClick={() =>
                        playlist || view === "Favorites"
                          ? navigate("Songs")
                          : search
                            ? setSearch("")
                            : setModal("import")
                      }
                    >
                      {playlist || view === "Favorites"
                        ? "Открыть песни"
                        : search
                          ? "Очистить поиск"
                          : "Импорт музыки"}
                      <ArrowRight size={15} />
                    </Button>
                  </div>
                ) : grid ? (
                  <div className="album-grid library-grid">
                    {albums.map((track, index) => (
                      <LibraryAlbumCard
                        key={track.album}
                        track={track}
                        index={index}
                        tracks={tracks}
                        openAlbum={openAlbum}
                        playTrack={playTrack}
                        openArtist={openArtist}
                      />
                    ))}
                  </div>
                ) : (
                  <TrackTable
                    list={visible}
                    currentId={currentId}
                    playing={playing}
                    favorites={favorites}
                    playTrack={playTrack}
                    openArtist={openArtist}
                    toggleFavorite={toggleFavorite}
                    setSelected={setSelected}
                  />
                )}
              </>
            )}
        </main>
        {lyricsOpen && (
          <LyricsPanel
            timelineOffset={timelineOffset}
            track={current}
            playing={playing}
            progress={progress}
            audio={exclusive ? undefined : audio}
            seek={seek}
            close={() => setLyricsOpen(false)}
          />
        )}
      </div>

      <Player
        playing={playing}
        current={current}
        favorites={favorites}
        progress={progress}
        duration={duration}
        seek={seek}
        shuffle={shuffle}
        setShuffle={setShuffle}
        advance={advance}
        audioLoading={audioLoading}
        togglePlay={togglePlay}
        repeat={repeat}
        setRepeat={setRepeat}
        output={output}
        exclusive={exclusive}
        playbackFormat={playbackFormat}
        volume={volume}
        setVolume={setVolume}
        lyricsOpen={lyricsOpen}
        setLyricsOpen={setLyricsOpen}
        queueOpen={queueOpen}
        setQueueOpen={setQueueOpen}
        openAlbum={openAlbum}
        openArtist={openArtist}
        toggleFavorite={toggleFavorite}
        onSettings={() => setModal("settings")}
      />
      <PlaybackSetup />
      <audio ref={audio} preload="metadata" {...audioProps} />
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        multiple
        accept="audio/*,.flac,.m4a,.opus,.xml,.csv"
        aria-label="Импортировать аудиофайлы"
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          void handleFiles(Array.from(e.target.files || []))
        }
      />

      {queueOpen && (
        <QueuePanel
          current={current}
          queue={queue}
          tracks={tracks}
          currentId={currentId}
          playTrack={playTrack}
          close={() => setQueueOpen(false)}
        />
      )}
      {modal === "import" && (
        <ImportDialog
          busy={busy}
          ready={ready}
          close={() => setModal(null)}
          onChoose={() => {
            linkTarget.current = null;
            fileInput.current?.click();
          }}
          onBrowse={() => fileInput.current?.click()}
          onApple={handleApple}
          onSoundCloud={handleSoundCloud}
        />
      )}
      {modal === "playlist" && (
        <PlaylistDialog
          busy={busy}
          playlistName={playlistName}
          close={() => setModal(null)}
          onName={setPlaylistName}
          onSubmit={createPlaylist}
        />
      )}
      {modal === "settings" && (
        <Suspense fallback={null}>
          <SettingsDialog
            gapless={gapless}
            onGapless={setGapless}
            equalizer={equalizer}
            onEqualizer={setEqualizer}
            theme={theme}
            onTheme={setTheme}
            preferExclusive={preferExclusive}
            onExclusive={setExclusive}
            exclusive={exclusive}
            output={output}
            volume={volume}
            onVolume={setVolume}
            accountName={account.name}
            tracks={libraryTracks}
            playlistCount={playlists.length}
            onImport={() => setModal("import")}
            onSwitchAccount={() => {
              setModal(null);
              onSwitchAccount();
            }}
            close={() => setModal(null)}
          />
        </Suspense>
      )}
      {selected && (
        <TrackMenu
          track={selected}
          busy={busy}
          downloading={downloading !== null}
          favorite={favorites.includes(selected.id)}
          playlists={playlists}
          inPlaylist={!!playlist}
          close={() => setSelected(null)}
          onFavorite={() => toggleFavorite(selected.id)}
          onArtist={() => openArtist(selected.artist)}
          onDownload={() => {
            void saveDownload(selected);
            setSelected(null);
          }}
          onQueue={() => {
            setTracks((old) =>
              old.some((t) => t.id === selected.id) ? old : [...old, selected],
            );
            setQueue((q) => [...q, selected.id]);
            setSelected(null);
            notify("Трек добавлен в конец очереди.");
          }}
          onLink={() => {
            linkTarget.current = selected;
            fileInput.current?.click();
          }}
          onPlaylist={(p) => {
            void addCatalogTracks([selected]);
            if (!p.tracks.includes(selected.id))
              setPlaylists((old) =>
                old.map((item) =>
                  item.id === p.id
                    ? { ...item, tracks: [...item.tracks, selected.id] }
                    : item,
                ),
              );
            notify(`Добавлено в «${p.name}».`);
          }}
          onRemove={() => {
            if (!playlist) return;
            setPlaylists((old) =>
              old.map((p) =>
                p.id === playlist.id
                  ? {
                      ...p,
                      tracks: p.tracks.filter((id) => id !== selected.id),
                    }
                  : p,
              ),
            );
            setSelected(null);
          }}
        />
      )}
      {dragging && (
        <div className="file-drag-overlay">
          <div>
            <Download size={50} />
            <h2>Импорт музыки</h2>
            <p>Перетащите файлы в окно для импорта.</p>
          </div>
        </div>
      )}
      <CommunityNotice
        enabled={
          ready &&
          !busy &&
          !modal &&
          !selected &&
          !toast &&
          !playbackError &&
          !audioLoading &&
          !dragging &&
          !lyricsOpen &&
          !queueOpen
        }
      />
      {(toast || playbackError) && (
        <div className="toast" role="status">
          <span>{toast || playbackError}</span>
          <IconButton
            icon={X}
            label="Закрыть уведомление"
            onClick={() => {
              setToast("");
              dismissPlaybackError();
            }}
          />
        </div>
      )}
    </SidebarProvider>
  );
}
