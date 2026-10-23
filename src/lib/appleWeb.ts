import { catalogJSON } from "./catalogRequest";
import { artistKey, type Artist, type ArtistRelease } from "./artists";
import { trackArtists, type Track } from "./library";

interface Descriptor {
  kind?: string;
  identifiers?: { storeAdamID?: string };
  url?: string;
}
interface Link {
  title?: string;
  segue?: { destination?: { contentDescriptor?: Descriptor } };
}
interface Artwork {
  dictionary?: { url?: string; defaultCropCode?: string };
  cropStyle?: string;
}
interface Item {
  title?: string;
  titleLinks?: Link[];
  subtitleLinks?: Link[];
  tertiaryLinks?: Link[];
  artistName?: string;
  duration?: number;
  trackNumber?: number;
  trackCount?: number;
  discNumber?: number;
  contentDescriptor?: Descriptor;
  artwork?: Artwork;
  colorBackdropArtwork?: Artwork;
  wideArtwork?: Artwork;
  tracks?: Item[];
}
interface WebPage {
  sections: { id: string; itemKind?: string; items?: Item[] }[];
}
function artwork(value?: Artwork) {
  const url = value?.dictionary?.url;
  if (!url?.startsWith("https://")) return undefined;
  return url
    .replaceAll("{w}", "800")
    .replaceAll("{h}", "800")
    .replaceAll("{f}", "jpg")
    .replaceAll(
      "{c}",
      value?.cropStyle || value?.dictionary?.defaultCropCode || "bb",
    );
}
function artist(item: Item): Artist | undefined {
  const id = Number(item.contentDescriptor?.identifiers?.storeAdamID);
  if (!id || !item.title || item.contentDescriptor?.kind !== "artist") return;
  return {
    id,
    name: item.title,
    catalog: "apple",
    picture_xl: artwork(
      item.colorBackdropArtwork || item.wideArtwork || item.artwork,
    ),
  };
}
export async function appleWebArtists(name: string) {
  const page = await catalogJSON<WebPage>(
    "appleweb",
    `/us/search?${new URLSearchParams({ term: name })}`,
  );
  const artists = page.sections
    .flatMap((section) => section.items || [])
    .map(artist)
    .filter((item): item is Artist => !!item);
  const unique = new Map<string, Artist>();
  for (const item of artists) {
    const key = String(item.id);
    if (artistKey(item.name).startsWith(artistKey(name)) && !unique.has(key))
      unique.set(key, item);
  }
  return [...unique.values()];
}
function songs(
  items: Item[],
  fallback: { artist: string; title?: string; cover?: string },
  releases: ArtistRelease[] = [],
): Track[] {
  return items.flatMap((item) => {
    const descriptor = item.contentDescriptor;
    const id = descriptor?.identifiers?.storeAdamID;
    if (
      descriptor?.kind !== "song" ||
      !id ||
      !/^\d+$/.test(id) ||
      !item.title ||
      !descriptor.url ||
      !item.duration ||
      item.duration <= 0
    )
      return [];
    const names = (item.subtitleLinks || [])
      .filter(
        (link) => link.segue?.destination?.contentDescriptor?.kind === "artist",
      )
      .flatMap((link) =>
        link.title
          ? trackArtists({ artist: link.title.replace(/\s+&\s+/g, ", ") })
          : [],
      );
    if (!names.length)
      names.push(
        ...trackArtists({
          artist: (item.artistName || fallback.artist).replace(
            /\s+&\s+/g,
            ", ",
          ),
        }),
      );
    const albumId = descriptor.url.match(/\/album\/[^/]+\/(\d+)/)?.[1];
    const release = releases.find(
      (release) => release.id === `apple:${albumId}`,
    );
    return [
      {
        id: `apple:${id}`,
        appleId: id,
        title: item.title,
        artist: names.join(", "),
        artists: names,
        album: fallback.title || release?.title || item.title,
        duration: item.duration / 1000,
        cover:
          artwork(item.artwork) ||
          fallback.cover ||
          release?.cover_big ||
          "/covers/imported.svg",
        discNumber: item.discNumber,
        trackNumber: item.trackNumber,
        source: "Lucida",
        fullRecording: true,
        format: "Аудио",
        qualityHint: "lossless",
        extractorUrl: descriptor.url,
        src: descriptor.url,
      } satisfies Track,
    ];
  });
}
async function profileById(match: Artist) {
  const page = await catalogJSON<WebPage>("appleweb", `/us/artist/${match.id}`);
  const header = page.sections.find(
    (section) => section.itemKind === "artistDetailHeader",
  )?.items?.[0];
  const found = header && artist(header);
  const releases: ArtistRelease[] = page.sections
    .filter((section) => /\.Albums-|\.ArtistSingles-/.test(section.id))
    .flatMap((section) =>
      (section.items || []).flatMap((item) => {
        const id = item.contentDescriptor?.identifiers?.storeAdamID;
        const title = item.titleLinks?.[0]?.title;
        if (!id || !title || item.contentDescriptor?.kind !== "album")
          return [];
        return [
          {
            id: `apple:${id}`,
            title,
            cover_big: artwork(item.artwork),
            release_date: item.subtitleLinks
              ?.map((link) => link.title)
              .find((text) => /^\d{4}$/.test(text || "")),
            record_type: /\bEP$/i.test(title)
              ? "ep"
              : /\bSingle$/i.test(title)
                ? "single"
                : "album",
          },
        ];
      }),
    );
  const tracks = page.sections.flatMap((section) =>
    (section.items || []).flatMap(
      (item) =>
        item.tracks || (item.contentDescriptor?.kind === "song" ? [item] : []),
    ),
  );
  const related = page.sections
    .filter((section) => section.id.includes(".SimilarArtists-"))
    .flatMap((section) => section.items || [])
    .map(artist)
    .filter((item): item is Artist => !!item);
  const catalog = {
    artist: { ...match, ...found },
    songs: songs(tracks, { artist: match.name }, releases),
    releases,
    related,
    more: false,
    partial: false,
  };
  if (!catalog.songs.length && !catalog.releases.length)
    throw new Error("Каталог артиста пуст");
  return catalog;
}
export async function appleWebProfile(
  name: string,
  hint?: Artist,
  saved: Track[] = [],
) {
  const matches = (
    await appleWebArtists(name).catch((error) => {
      if (hint?.catalog === "apple") return [hint];
      throw error;
    })
  ).filter((item) => artistKey(item.name) === artistKey(name));
  if (hint?.catalog === "apple") {
    const index = matches.findIndex((item) => item.id === hint.id);
    if (index >= 0) matches.splice(index, 1);
    matches.unshift(hint);
  }
  if (!matches.length) throw new Error("Артист не найден");
  const results = await Promise.allSettled(
    matches.slice(0, 4).map(profileById),
  );
  const profiles = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (!profiles.length) throw new Error("Каталог артиста недоступен");
  const evidence = saved.filter((track) =>
    trackArtists(track).some((artist) => artistKey(artist) === artistKey(name)),
  );
  const score = (profile: (typeof profiles)[number]) => {
    const albums = new Set(
      profile.releases.map((release) =>
        artistKey(release.title.replace(/\s*-\s*(Single|EP)$/i, "")),
      ),
    );
    const titles = new Set(
      profile.songs.map((track) => artistKey(track.title)),
    );
    const matches = evidence.filter(
      (track) =>
        albums.has(artistKey(track.album)) ||
        titles.has(artistKey(track.title)),
    ).length;
    return (
      matches * 10000 +
      profile.releases.filter((release) => release.record_type === "album")
        .length *
        100 +
      profile.releases.length
    );
  };
  const selected = hint
    ? profiles.find((profile) => profile.artist.id === hint.id)
    : [...profiles].sort((a, b) => score(b) - score(a))[0];
  if (!selected) throw new Error("Выбранный профиль артиста недоступен");
  return {
    ...selected,
    partial: results.some((result) => result.status === "rejected"),
    alternatives: profiles.map((profile) => ({
      artist: profile.artist,
      label:
        profile.releases.find((release) => release.record_type === "album")
          ?.title ||
        profile.releases[0]?.title ||
        profile.artist.name,
    })),
  };
}
export async function appleWebAlbum(id: string) {
  if (!/^\d+$/.test(id)) throw new Error("Неверный ID альбома");
  const page = await catalogJSON<WebPage>("appleweb", `/us/album/${id}`);
  const header = page.sections.find(
    (section) => section.itemKind === "containerDetailHeaderLockup",
  )?.items?.[0];
  if (!header?.title) throw new Error("Альбом не найден");
  const items = page.sections
    .filter((section) => section.itemKind === "trackLockup")
    .flatMap((section) => section.items || []);
  const tracks = songs(items, {
    artist:
      header.subtitleLinks
        ?.map((link) => link.title)
        .filter(Boolean)
        .join(", ") || "",
    title: header.title,
    cover: artwork(header.artwork),
  });
  if (
    !tracks.length ||
    tracks.length !== items.length ||
    (header.trackCount && tracks.length !== header.trackCount)
  )
    throw new Error("Не удалось загрузить полный треклист");
  return tracks;
}
