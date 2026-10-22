import { catalogJSON } from "./catalogRequest";
import { trackArtists, type Track } from "./library";
import { appleAlbum, appleSearch, appleTracks } from "./appleCatalog";

export interface Artist {
  id: number;
  name: string;
  picture_xl?: string;
  picture_big?: string;
}
export interface ArtistRelease {
  id: number | string;
  title: string;
  cover_big?: string;
  cover_medium?: string;
  release_date?: string;
  record_type?: string;
  tracks?: Track[];
  contributors?: (Artist & { role?: string })[];
}
interface CatalogSong {
  id: number;
  title: string;
  duration: number;
  disk_number?: number;
  track_position?: number;
  readable?: boolean;
  artist: Artist;
  contributors?: Artist[];
  album?: { title: string; cover_big?: string; cover_medium?: string };
}
interface Page<T> {
  data: T[];
  next?: string;
  error?: { message?: string };
}
export const artistKey = (name: string) =>
  name
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function isArtist(track: Track, name: string) {
  return trackArtists(track).some(
    (artist) => artistKey(artist) === artistKey(name),
  );
}

function checkedId(id: number | string) {
  if (!/^\d+$/.test(String(id))) throw new Error("Invalid catalog ID");
  return String(id);
}
async function page<T>(path: string) {
  const response = await catalogJSON<Page<T>>("deezer", path);
  if (response.error || !Array.isArray(response.data))
    throw new Error("Каталог сейчас недоступен");
  return response;
}
export async function searchArtists(query: string): Promise<Artist[]> {
  if (!query.trim()) return [];
  const response = await page<Artist>(
    `/search/artist?${new URLSearchParams({ q: query, limit: "12" })}`,
  );
  const term = artistKey(query);
  return response.data
    .filter(
      (artist) =>
        artist.id &&
        typeof artist.name === "string" &&
        artistKey(artist.name).startsWith(term),
    )
    .sort(
      (a, b) =>
        Number(artistKey(b.name) === term) - Number(artistKey(a.name) === term),
    );
}
export async function findArtist(name: string): Promise<Artist | undefined> {
  return (await searchArtists(name)).find(
    (artist) => artistKey(artist.name) === artistKey(name),
  );
}
function artistTracks(
  items: CatalogSong[],
  album?: ArtistRelease,
  fullAlbum = false,
): Track[] {
  return items
    .filter(
      (song) =>
        song.id &&
        (fullAlbum ? song.duration > 0 : song.duration > 30) &&
        (fullAlbum || song.readable !== false) &&
        song.artist?.name,
    )
    .map((song) => {
      const url = `https://www.deezer.com/track/${checkedId(song.id)}`;
      return {
        id: `deezer:${song.id}`,
        fullRecording: fullAlbum || undefined,
        discNumber: song.disk_number,
        trackNumber: song.track_position,
        title: song.title,
        artist: song.artist.name,
        artists: [
          ...new Set([
            song.artist.name,
            ...(song.contributors || []).map((artist) => artist.name),
          ]),
        ],
        album: album?.title || song.album?.title || song.title,
        duration: song.duration,
        cover:
          album?.cover_big ||
          album?.cover_medium ||
          song.album?.cover_big ||
          song.album?.cover_medium ||
          "/covers/imported.svg",
        source: "Lucida",
        format: "Аудио",
        qualityHint: "lossless",
        extractorUrl: url,
        src: url,
        attributionUrl: url,
        downloadAllowed: true,
      };
    });
}
export async function artistReleases(id: number, index = 0) {
  const response = await page<ArtistRelease>(
    `/artist/${checkedId(id)}/albums?limit=50&index=${index}`,
  );
  return { releases: response.data, more: !!response.next };
}
export async function releaseTracks(release: ArtistRelease) {
  if (Array.isArray(release.tracks)) return release.tracks;
  if (String(release.id).startsWith("apple:"))
    return appleAlbum(String(release.id).slice(6));
  const items: CatalogSong[] = [];
  let more = true;
  while (more) {
    const response = await page<CatalogSong>(
      `/album/${checkedId(release.id)}/tracks?limit=100&index=${items.length}`,
    );
    items.push(...response.data);
    more = !!response.next;
    if (more && !response.data.length)
      throw new Error("Неполный треклист альбома");
  }
  for (let offset = 0; offset < items.length; offset += 6) {
    await Promise.all(
      items.slice(offset, offset + 6).map(async (song) => {
        if (song.contributors?.length) return;
        try {
          const full = await catalogJSON<CatalogSong>(
            "deezer",
            `/track/${checkedId(song.id)}`,
          );
          if (full?.id === song.id && full.contributors?.length)
            song.contributors = full.contributors;
        } catch {}
      }),
    );
  }
  return artistTracks(items, release, true);
}
async function deezerProfile(name: string) {
  const artist = await findArtist(name);
  if (!artist) return;
  const results = await Promise.allSettled([
    page<CatalogSong>(`/artist/${artist.id}/top?limit=20`).then((response) =>
      artistTracks(response.data),
    ),
    artistReleases(artist.id),
    page<Artist>(`/artist/${artist.id}/related?limit=6`).then(
      (response) => response.data,
    ),
  ] as const);
  return {
    artist,
    songs: results[0].status === "fulfilled" ? results[0].value : [],
    releases:
      results[1].status === "fulfilled" ? results[1].value.releases : [],
    more: results[1].status === "fulfilled" && results[1].value.more,
    related: results[2].status === "fulfilled" ? results[2].value : [],
    partial: results.some((result) => result.status === "rejected"),
  };
}

async function appleProfile(name: string) {
  const items = (await appleSearch(name)).filter(
    (item) => artistKey(item.artistName) === artistKey(name),
  );
  if (!items.length) return;
  const songs = appleTracks(items);
  const releases: ArtistRelease[] = [
    ...new Map(
      items
        .filter((item) => item.collectionId)
        .map((item) => [
          item.collectionId,
          {
            id: `apple:${item.collectionId}`,
            title: item.collectionName || item.trackName || "",
            cover_big: item.artworkUrl100?.replace(/100x100bb/, "600x600bb"),
            release_date: item.releaseDate,
          },
        ]),
    ).values(),
  ];
  return {
    artist: { id: items[0].artistId, name: items[0].artistName } as Artist,
    songs,
    releases,
    more: false,
    related: [] as Artist[],
    partial: false,
  };
}

export async function artistProfile(name: string) {
  try {
    const profile = await deezerProfile(name);
    if (profile?.songs.length && profile.releases.length) return profile;
    return (await appleProfile(name)) || profile;
  } catch {
    return appleProfile(name);
  }
}

export async function waveArtistTracks(
  name: string,
  discover: boolean,
  seed: number,
): Promise<Track[]> {
  let artist: Artist | undefined;
  try {
    artist = await findArtist(name);
  } catch {}
  if (!artist) return (await appleProfile(name))?.songs || [];
  const own = page<CatalogSong>(`/artist/${artist.id}/top?limit=30`)
    .then((r) => artistTracks(r.data))
    .catch(async () => (await appleProfile(name))?.songs || []);
  if (!discover) return own;
  const related = await page<Artist>(
    `/artist/${artist.id}/related?limit=10`,
  ).catch(() => ({ data: [] as Artist[] }));
  const selected = related.data.length
    ? related.data[seed % related.data.length]
    : undefined;
  const result = await Promise.allSettled([
    own,
    selected
      ? page<CatalogSong>(`/artist/${selected.id}/top?limit=15`).then((r) =>
          artistTracks(r.data),
        )
      : Promise.resolve([]),
  ]);
  return result.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
