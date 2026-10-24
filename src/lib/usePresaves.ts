import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { loudRelease } from "./loudCatalog";
import { clearCatalogCache } from "./catalogRequest";
import { storeTracks, type Track } from "./library";

export function usePresaves(
  tracks: Track[],
  setTracks: Dispatch<SetStateAction<Track[]>>,
) {
  const current = useRef(tracks);
  current.current = tracks;
  const signature = JSON.stringify(
    tracks
      .filter((track) => track.availableAt && track.loudReleaseId)
      .map((track) => [track.id, track.availableAt]),
  );
  useEffect(() => {
    if (signature === "[]") return;
    let live = true;
    let running = false;
    const refresh = async () => {
      if (running || navigator.onLine === false) return;
      const due = current.current.filter(
        (track) =>
          track.availableAt &&
          Date.parse(track.availableAt) <= Date.now() &&
          track.loudReleaseId,
      );
      if (!due.length) return;
      running = true;
      clearCatalogCache(["loud"]);
      const result = await Promise.allSettled(
        [...new Set(due.map((track) => track.loudReleaseId!))].map((id) =>
          loudRelease(`loud:${id}`),
        ),
      );
      if (live) {
        const fresh = new Map(
          result
            .flatMap((value) =>
              value.status === "fulfilled" && value.value.available !== false
                ? value.value.tracks || []
                : [],
            )
            .map((track) => [track.id, track]),
        );
        const unlocked = due
          .filter((track) => fresh.has(track.id))
          .map((track) => ({
            ...track,
            ...fresh.get(track.id)!,
            inLibrary: track.inLibrary,
          }));
        if (unlocked.length) {
          try {
            await storeTracks(
              unlocked
                .filter((track) => track.inLibrary)
                .map((track) => ({ track })),
            );
            if (live)
              setTracks((before) =>
                before.map((track) =>
                  track.availableAt && fresh.has(track.id)
                    ? {
                        ...track,
                        ...fresh.get(track.id)!,
                        inLibrary: track.inLibrary,
                      }
                    : track,
                ),
              );
          } catch (error) {
            window.dispatchEvent(
              new CustomEvent("loud-storage-error", { detail: String(error) }),
            );
          }
        }
      }
      running = false;
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const upcoming = tracks
      .filter((track) => track.availableAt)
      .map((track) => Date.parse(track.availableAt!))
      .filter((time) => time > Date.now());
    const nearest = upcoming.length ? Math.min(...upcoming) : 0;
    const releaseTimer = nearest
      ? setTimeout(
          () => void refresh(),
          Math.min(2147483647, Math.max(0, nearest - Date.now() + 100)),
        )
      : undefined;
    window.addEventListener("online", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      clearTimeout(releaseTimer);
      window.removeEventListener("online", refresh);
    };
  }, [signature, setTracks]);
}
