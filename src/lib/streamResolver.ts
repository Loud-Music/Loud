import { trackArtists, type Track } from "./library";
import { sourcePriority } from "./sourcePriority";

const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function sameRecording(wanted: Track, candidate: Track) {
  if (
    candidate.preview ||
    (candidate.duration <= 30 && !wanted.fullRecording) ||
    Math.abs(candidate.duration - wanted.duration) > 3
  )
    return false;
  const artists = trackArtists(wanted).map(normalize);
  const artist = normalize(wanted.artist),
    title = normalize(wanted.title);
  const cleanedTitle = candidate.title
    .replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/g, "")
    .replace(
      /\s*[([](?:official\s+)?(?:music\s+video|audio|lyric\s+video|lyrics)(?:\s+hd|\s+4k)?[)\]]\s*$/gi,
      "",
    )
    .replace(
      /\s*[-–—]\s*(?:official\s+)?(?:music\s+video|audio|lyric\s+video|lyrics)\s*$/gi,
      "",
    );
  const candidateTitle = normalize(cleanedTitle);
  const credits = (candidate.artists || [candidate.artist])
    .flatMap((name) =>
      name.normalize("NFKC").split(/\s*(?:,|;|&|\$|\bfeat\.?|\bft\.?)\s*/i),
    )
    .map(normalize);
  const prefix = cleanedTitle.match(/^(.*?)\s+[-–—]\s+(.+)$/);
  const creditedPrefix =
    prefix && ` ${normalize(prefix[1])} `.includes(` ${artist} `);
  return (
    (artists.some((name) => credits.includes(name)) &&
      candidateTitle === title) ||
    candidateTitle === `${artist} ${title}` ||
    !!(creditedPrefix && normalize(prefix[2]) === title)
  );
}
interface StreamDependencies {
  signal?: AbortSignal;
  metadataOnly?: boolean;
  resolve: (track: Track) => Promise<Track>;
  discover: (
    track: Track,
    offer: (tracks: Track[]) => void,
  ) => Promise<Track[]>;
  discoverPrimary?: (track: Track) => Promise<Track[]>;
  prepared?: (track: Track) => void;
}
export function chooseStream(
  track: Track,
  dependencies: StreamDependencies,
  excluded: readonly string[] = [],
): Promise<Track> {
  return new Promise((resolve, reject) => {
    if (dependencies.signal?.aborted) {
      reject(new DOMException("Подготовка отменена", "AbortError"));
      return;
    }
    const seen = new Set(excluded);
    const queue: Track[] = [];
    let amazonRunning = 0;
    let fallbackRunning = 0;
    let running = 0,
      discovering = true,
      primaryDiscovering = !!dependencies.discoverPrimary;
    let settled = false,
      releaseFallback = false,
      releaseSecondary = false;
    let best: Track | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const score = (song: Track) =>
      song.format === "FLAC"
        ? 4
        : song.format === "MP3"
          ? 3
          : song.format === "AAC"
            ? 2
            : 1;
    const abort = () => finish(undefined, true);
    const finish = (value?: Track, aborted = false) => {
      if (settled) return;
      settled = true;
      dependencies.signal?.removeEventListener("abort", abort);
      for (const timer of timers) clearTimeout(timer);
      if (value) {
        best = value;
        resolve(value);
      } else if (aborted)
        reject(new DOMException("Подготовка отменена", "AbortError"));
      else
        reject(
          new Error(
            "Полная запись сейчас недоступна. Попробуйте позже или добавьте локальный файл.",
          ),
        );
    };
    dependencies.signal?.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(() => finish(best), 28000);
    timers.add(deadline);
    const drain = () => {
      if (settled) return;
      if (
        best &&
        (!dependencies.metadataOnly ||
          best.format === "FLAC" ||
          (dependencies.metadataOnly && sourcePriority(best) === 0) ||
          releaseFallback)
      )
        return finish(best);
      queue.sort((a, b) => sourcePriority(a) - sourcePriority(b));
      while (running < 4 && queue.length) {
        const index = queue.findIndex((item) => {
          const priority = sourcePriority(item);
          if (priority === 0) return amazonRunning < 1;
          if (priority === 2) return fallbackRunning < 2;
          return (
            !dependencies.metadataOnly ||
            releaseSecondary ||
            (!primaryDiscovering && !amazonRunning)
          );
        });
        if (index < 0) break;
        const candidate = queue.splice(index, 1)[0];
        running++;
        if (sourcePriority(candidate) === 0) amazonRunning++;
        if (sourcePriority(candidate) === 2) fallbackRunning++;
        let completed = false;
        const done = (value?: Track) => {
          if (completed) return;
          completed = true;
          running--;
          if (sourcePriority(candidate) === 0) amazonRunning--;
          if (sourcePriority(candidate) === 2) fallbackRunning--;
          clearTimeout(timer);
          timers.delete(timer);
          if (settled) return;
          if (
            value &&
            !value.preview &&
            (value.duration > 30 || track.fullRecording) &&
            Math.abs(value.duration - track.duration) <= 3
          ) {
            dependencies.prepared?.(value);
            if (
              !best ||
              score(value) > score(best) ||
              (score(value) === score(best) &&
                sourcePriority(value) < sourcePriority(best))
            )
              best = value;
          }
          drain();
        };
        const timer = setTimeout(
          () => done(),
          sourcePriority(candidate) < 2 ? 18500 : 20500,
        );
        timers.add(timer);
        void dependencies.resolve(candidate).then(
          (value) => done(value),
          () => done(),
        );
      }
      if (!running && !primaryDiscovering && !discovering) finish(best);
    };
    const add = (candidate: Track) => {
      const url = candidate.extractorUrl || candidate.src;
      if (!url || seen.has(url)) return;
      seen.add(url);
      queue.push(candidate);
    };
    [
      track,
      ...(track.alternatives || []).map((item) => ({
        ...track,
        extractorUrl: item.url,
        src: item.url,
        duration: item.duration,
        qualityHint: item.quality,
        alternatives: undefined,
      })),
    ].forEach(add);
    timers.add(
      setTimeout(() => {
        releaseSecondary = true;
        drain();
      }, 300),
    );
    timers.add(
      setTimeout(
        () => {
          releaseFallback = true;
          drain();
        },
        dependencies.metadataOnly ? 4000 : 500,
      ),
    );
    drain();
    if (dependencies.discoverPrimary)
      void dependencies
        .discoverPrimary(track)
        .then(
          (found) =>
            found
              .filter((candidate) => sameRecording(track, candidate))
              .forEach(add),
          () => {},
        )
        .finally(() => {
          primaryDiscovering = false;
          drain();
        });
    void dependencies
      .discover(track, (found) => {
        if (settled) return;
        found
          .filter((candidate) => sameRecording(track, candidate))
          .forEach(add);
        drain();
      })
      .then(
        (found) => {
          if (!settled)
            found
              .filter((candidate) => sameRecording(track, candidate))
              .forEach(add);
        },
        () => {},
      )
      .finally(() => {
        discovering = false;
        drain();
      });
  });
}
