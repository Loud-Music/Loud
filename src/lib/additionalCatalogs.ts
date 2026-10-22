import { catalogJSON } from "./catalogRequest";
import { openLicense } from "./catalog";
import type { Track } from "./library";

function plain(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}
function seconds(value = "") {
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}
interface MixterUpload {
  upload_id: number;
  upload_name: string;
  user_real_name?: string;
  user_name: string;
  file_page_url: string;
  license_url: string;
  upload_tags?: string;
  files: {
    file_name: string;
    download_url: string;
    file_order: number;
    file_format_info?: { ps?: string; sr?: string };
  }[];
}
function mixterTracks(uploads: MixterUpload[]): Track[] {
  return uploads.flatMap((upload) => {
    if (!openLicense(upload.license_url)) return [];
    const files = upload.files.filter(
      (file) =>
        /^https:\/\/ccmixter\.org\/content\//.test(file.download_url) &&
        /\.(flac|mp3)$/i.test(file.file_name),
    );
    const main = files.find((file) => file.file_order === 0) || files[0];
    if (!main) return [];
    const stem = main.file_name.replace(/\.[^.]+$/, "");
    const file =
      files.find(
        (file) => file.file_name.toLowerCase() === `${stem}.flac`.toLowerCase(),
      ) || main;
    const duration = seconds(file.file_format_info?.ps);
    if (duration < 30) return [];
    return [
      {
        id: `ccmixter:${upload.upload_id}`,
        title: plain(upload.upload_name),
        artist: plain(upload.user_real_name || upload.user_name),
        album: plain(upload.upload_name),
        duration,
        source: "ccMixter" as const,
        format: /\.flac$/i.test(file.file_name) ? "FLAC" : "MP3",
        src: file.download_url,
        remoteUrl: file.download_url,
        downloadAllowed: true,
        cover: "/covers/imported.svg",
        attributionUrl: upload.file_page_url,
        license: upload.license_url,
        tags: (upload.upload_tags || "").split(",").filter(Boolean),
      },
    ];
  });
}
export async function searchMixter(query: string) {
  const params = new URLSearchParams({
    f: "json",
    search: query,
    search_type: "all",
    tags: "remix",
    limit: "30",
    dataview: "default",
  });
  const data = await catalogJSON<MixterUpload[]>(
    "ccmixter",
    `/api/query?${params}`,
  );
  if (!Array.isArray(data)) throw new Error("Invalid ccMixter response");
  return mixterTracks(data);
}

interface JamendoRecording {
  id: string;
  title: string;
  creator: string;
  url: string;
  duration: number;
  category: string;
  license_url: string;
  foreign_landing_url: string;
  thumbnail?: string;
  genres?: string[];
  tags?: { name: string }[];
  audio_set?: { title: string };
}
function jamendoTracks(items: JamendoRecording[]): Track[] {
  return items.flatMap((item) => {
    if (
      item.category !== "music" ||
      item.duration < 30000 ||
      !openLicense(item.license_url)
    )
      return [];
    const url = new URL(item.url);
    if (
      url.protocol !== "https:" ||
      !/^prod-\d+\.storage\.jamendo\.com$/.test(url.hostname)
    )
      return [];
    return [
      {
        id: `jamendo:${item.id}`,
        title: plain(item.title),
        artist: plain(item.creator),
        album: plain(item.audio_set?.title || item.title),
        duration: item.duration / 1000,
        cover: item.thumbnail || "/covers/imported.svg",
        source: "Jamendo" as const,
        format: "MP3",
        src: item.url,
        downloadAllowed: false,
        attributionUrl: item.foreign_landing_url,
        license: item.license_url,
        tags: [...(item.genres || []), ...(item.tags || []).map((t) => t.name)],
      },
    ];
  });
}
export async function searchJamendo(query: string) {
  const params = new URLSearchParams({
    q: query,
    source: "jamendo",
    category: "music",
    page_size: "5",
  });
  const data = await catalogJSON<{ results: JamendoRecording[] }>(
    "openverse",
    `/v1/audio/?${params}`,
  );
  if (!Array.isArray(data.results))
    throw new Error("Invalid Jamendo index response");
  return jamendoTracks(data.results);
}
