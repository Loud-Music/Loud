import { recordingKey, trackArtists } from "./library";
import type { CatalogAlbum } from "./catalog";
import type { Track } from "./library";
export const tasteGenres = [
  "Electronic",
  "Ambient",
  "Jazz",
  "Classical",
  "Rock",
  "Hip-Hop",
  "Techno",
  "House",
  "Experimental",
  "Folk",
  "Dub",
  "Post-Rock",
];
export type Feedback = "like" | "unlike" | "listen" | "skip" | "dislike";
const genreLabels: Record<string, string> = {
  Electronic: "Электроника",
  Ambient: "Эмбиент",
  Jazz: "Джаз",
  Classical: "Классика",
  Rock: "Рок",
  "Hip-Hop": "Хип-хоп",
  Techno: "Техно",
  House: "Хаус",
  Experimental: "Экспериментальная",
  Folk: "Фолк",
  Dub: "Даб",
  "Post-Rock": "Построк",
};
export const genreLabel = (genre: string) => genreLabels[genre] || genre;
export interface TasteProfile {
  genres: string[];
  genreWeights: Record<string, number>;
  artistWeights: Record<string, number>;
  blockedReleases: string[];
  history: {
    id: string;
    album: string;
    artist: string;
    recording?: string;
    event: Feedback;
    at: number;
  }[];
  mix: "balanced" | "familiar" | "discovery";
  energy: "all" | "calm" | "energetic";
  updated: number;
}
export const emptyTaste = (): TasteProfile => ({
  genres: [],
  genreWeights: {},
  artistWeights: {},
  blockedReleases: [],
  history: [],
  mix: "balanced",
  energy: "all",
  updated: Date.now(),
});
const normalize = (value: string) => value.trim().toLowerCase();
function tagsFor(item: {
  tags?: string[];
  genre?: string;
  title?: string;
  album?: string;
}): string[] {
  const raw = [...(item.tags || []), item.genre || ""].map(normalize);
  const joined = raw.join(" ");
  const aliases: Record<string, string[]> = {
    electronic: [
      "electronica",
      "electronic",
      "idm",
      "downtempo",
      "trip-hop",
      "trip hop",
    ],
    ambient: ["ambient", "drone", "soundscape", "chillout"],
    jazz: ["jazz", "swing", "bebop"],
    classical: ["classical", "orchestral", "chamber", "piano"],
    rock: ["rock", "guitar"],
    "hip-hop": ["hip-hop", "hip hop", "rap", "beats"],
    techno: ["techno"],
    house: ["house"],
    experimental: ["experimental", "avant-garde"],
    folk: ["folk", "acoustic"],
    dub: ["dub", "reggae"],
    "post-rock": ["post-rock", "post rock"],
  };
  return [
    ...new Set([
      ...raw,
      ...Object.entries(aliases)
        .filter(([, terms]) => terms.some((term) => joined.includes(term)))
        .map(([genre]) => genre),
    ]),
  ].filter(Boolean);
}
export function updateTaste(
  profile: TasteProfile,
  track: Track,
  event: Feedback,
  now = Date.now(),
): TasteProfile {
  const decay = Math.pow(
    0.5,
    Math.max(0, now - profile.updated) / (30 * 86400000),
  );
  const genreWeights = Object.fromEntries(
    Object.entries(profile.genreWeights).map(([key, w]) => [key, w * decay]),
  );
  const artistWeights = Object.fromEntries(
    Object.entries(profile.artistWeights).map(([key, w]) => [key, w * decay]),
  );
  const amount = { like: 4, unlike: -3, listen: 1, skip: -0.7, dislike: -5 }[
    event
  ];
  for (const tag of tagsFor(track))
    genreWeights[tag] = Math.max(
      -12,
      Math.min(20, (genreWeights[tag] || 0) + amount),
    );
  for (const name of trackArtists(track)) {
    const artist = normalize(name);
    artistWeights[artist] = Math.max(
      -15,
      Math.min(25, (artistWeights[artist] || 0) + amount * 1.5),
    );
  }
  return {
    ...profile,
    genreWeights,
    artistWeights,
    updated: now,
    history: [
      {
        id: track.id,
        album: track.album,
        artist: track.artist,
        recording: recordingKey(track),
        event,
        at: now,
      },
      ...profile.history,
    ].slice(0, 400),
    blockedReleases:
      event === "dislike"
        ? [...new Set([...profile.blockedReleases, track.album])].slice(-200)
        : profile.blockedReleases,
  };
}
export function seededNoise(value: string, seed: number) {
  let hash = seed | 0;
  for (const char of value)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}
interface RankedAlbum {
  album: CatalogAlbum;
  score: number;
  reason: string;
}
export function rankAlbums(
  candidates: CatalogAlbum[],
  profile: TasteProfile,
  seed: number,
  limit = 12,
): RankedAlbum[] {
  const selected = new Set(profile.genres.map(normalize));
  const history = profile.history;
  const latest = history.find(
    (h) => h.event === "listen" || h.event === "like",
  );
  const scores = [...new Map(candidates.map((a) => [a.id, a])).values()]
    .filter(
      (a) =>
        !profile.blockedReleases.includes(a.title) &&
        (profile.artistWeights[normalize(a.artist)] || 0) > -8,
    )
    .map((album) => {
      const tags = tagsFor(album);
      let affinity = 0;
      for (const tag of tags)
        affinity +=
          (selected.has(tag) ? 3 : 0) + (profile.genreWeights[tag] || 0) * 0.45;
      const artistAffinity =
        profile.artistWeights[normalize(album.artist)] || 0;
      const heard = history.filter((h) => h.album === album.title).length;
      const discovery =
        profile.mix === "discovery"
          ? 3
          : profile.mix === "familiar"
            ? 0.4
            : 1.2;
      let score =
        affinity +
        artistAffinity * (profile.mix === "familiar" ? 1.3 : 0.6) +
        seededNoise(album.id, seed) * discovery * 3 -
        heard * 3;
      if (profile.energy === "calm")
        score += tags.some((t) =>
          /ambient|classical|chill|drone|piano|folk/.test(t),
        )
          ? 5
          : -2;
      if (profile.energy === "energetic")
        score += tags.some((t) => /techno|house|rock|dance|hip-hop/.test(t))
          ? 5
          : -2;
      if (latest && normalize(latest.artist) === normalize(album.artist))
        score -= 3;
      const topTag = tags
        .filter((t) => selected.has(t) || (profile.genreWeights[t] || 0) > 2)
        .sort(
          (a, b) =>
            (profile.genreWeights[b] || 0) - (profile.genreWeights[a] || 0),
        )[0];
      return {
        album,
        score,
        reason:
          artistAffinity > 3
            ? "Из-за ваших лайков этому исполнителю"
            : topTag
              ? `По вашему вкусу: ${topTag}`
              : "Новое для вас",
      };
    })
    .sort((a, b) => b.score - a.score);
  const result: RankedAlbum[] = [];
  const artistCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  while (scores.length && result.length < limit) {
    let best = -1,
      bestScore = -Infinity;
    const exploreSlot =
      profile.mix === "discovery"
        ? result.length % 3 === 2
        : profile.mix === "balanced"
          ? result.length % 4 === 3
          : false;
    const isDiscovery = (item: RankedAlbum) =>
      !tagsFor(item.album).some((tag) => selected.has(tag)) &&
      !history.some((h) => h.album === item.album.title);
    const availableDiscovery =
      exploreSlot &&
      scores.some(
        (item) =>
          isDiscovery(item) &&
          (artistCounts.get(normalize(item.album.artist)) || 0) < 2,
      );
    scores.forEach((item, i) => {
      const artist = normalize(item.album.artist);
      if ((artistCounts.get(artist) || 0) >= 2) return;
      if (availableDiscovery && !isDiscovery(item)) return;
      const repetition =
        (artistCounts.get(artist) || 0) * 5 +
        (result.at(-1) && normalize(result.at(-1)!.album.artist) === artist
          ? 12
          : 0);
      const tagPenalty = tagsFor(item.album)
        .filter((t) => selected.has(t))
        .reduce((sum, t) => sum + (genreCounts.get(t) || 0) * 0.8, 0);
      const score = item.score - repetition - tagPenalty;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best < 0) break;
    const [item] = scores.splice(best, 1);
    result.push(item);
    const artist = normalize(item.album.artist);
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    for (const tag of tagsFor(item.album))
      genreCounts.set(tag, (genreCounts.get(tag) || 0) + 1);
  }
  return result;
}

export function waveArtists(profile: TasteProfile, seed: number): string[] {
  const weights = new Map(Object.entries(profile.artistWeights));
  for (const event of profile.history.slice(0, 40)) {
    const artist = normalize(event.artist);
    if (event.event === "listen" || event.event === "like")
      weights.set(artist, (weights.get(artist) || 0) + 1);
  }
  const ranked = [...weights]
    .filter(([name, weight]) => weight > 0 && !/(?:[рс][^\s]){4}/i.test(name))
    .sort(
      (a, b) =>
        b[1] +
        seededNoise(b[0], seed) * 4 -
        (a[1] + seededNoise(a[0], seed) * 4),
    )
    .map(([artist]) => artist);
  const pool = ranked.slice(1, 13);
  return ranked.length
    ? [
        ...new Set([
          ranked[0],
          ...(pool.length
            ? [
                pool[seed % pool.length],
                pool[(seed + Math.ceil(pool.length / 2)) % pool.length],
              ]
            : []),
        ]),
      ]
    : [];
}
export function recentWaveHistory(profile: TasteProfile) {
  const since = Date.now() - 6 * 3600000;
  return profile.history
    .filter(
      (event) =>
        (event.event === "listen" || event.event === "skip") &&
        event.at > since,
    )
    .slice(0, 12);
}

export function freshWaveTracks(
  tracks: Track[],
  profile: TasteProfile,
  exclude: string[] = [],
) {
  const ids = new Set(exclude);
  const history = recentWaveHistory(profile);
  const recent = new Set(history.map((event) => event.id));
  const recordings = new Set(
    history.flatMap((event) => (event.recording ? [event.recording] : [])),
  );
  const seen = new Set<string>();
  return tracks.filter((track) => {
    const key = recordingKey(track);
    if (
      ids.has(track.id) ||
      recent.has(track.id) ||
      recordings.has(key) ||
      seen.has(key) ||
      profile.blockedReleases.includes(track.album) ||
      (profile.artistWeights[normalize(track.artist)] || 0) <= -8
    )
      return false;
    seen.add(key);
    return true;
  });
}
