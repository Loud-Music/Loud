import { parseBlob } from "music-metadata";
import type { Track, Source } from "./library";

const cover = "/covers/imported.svg";
function hash(text: string) {
  let value = 2166136261;
  for (const c of text) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return (value >>> 0).toString(36);
}
async function importAudio(file: File): Promise<{ track: Track; blob: Blob }> {
  let title = file.name.replace(/\.[^.]+$/, ""),
    artist = "Неизвестный исполнитель",
    album = "Локальная коллекция",
    duration = 0,
    artwork = cover;
  let audioFormat = /\.flac$/i.test(file.name)
    ? "FLAC"
    : file.name.split(".").pop()?.toUpperCase();
  let artists: string[] | undefined;
  let sampleRate: number | undefined, bitDepth: number | undefined;
  try {
    const { common, format } = await parseBlob(file);
    title = common.title || title;
    artist = common.artist || artist;
    artists = common.artists;
    album = common.album || album;
    duration = format.duration || 0;
    audioFormat = format.container?.toUpperCase() || audioFormat;
    sampleRate = format.sampleRate;
    bitDepth = format.bitsPerSample;
    if (common.picture?.[0]) {
      const pic = common.picture[0];
      artwork = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(
          new Blob([new Uint8Array(pic.data)], { type: pic.format }),
        );
      });
    }
  } catch {}
  return {
    track: {
      id: `local-${[...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      title,
      artist,
      artists,
      album,
      duration,
      cover: artwork,
      source: "Local",
      src: URL.createObjectURL(file),
      format: audioFormat,
      sampleRate,
      bitDepth,
    },
    blob: file,
  };
}
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted)
    throw new Error("В CSV не закрыта кавычка. Экспортируйте файл заново.");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
function importCSV(text: string): Track[] {
  const [head, ...rows] = parseCSV(text.replace(/^\uFEFF/, ""));
  if (!head) throw new Error("Файл CSV пуст.");
  const headers = head.map((x) => x.trim().toLowerCase());
  const find = (...names: string[]) =>
    headers.findIndex((h) => names.includes(h));
  const ti = find("track name", "track", "name", "title"),
    ar = find("artist name(s)", "artist name", "artists", "artist"),
    al = find("album name", "album"),
    du = find("duration (ms)", "duration_ms");
  if (ti < 0) throw new Error("В CSV нужен столбец Track Name или Title.");
  return rows
    .filter((row) => row[ti]?.trim())
    .map((row) => ({
      id: `csv-${hash(`${row[ti]}-${row[ar]}-${row[al]}`)}`,
      title: row[ti],
      artist: row[ar] || "Неизвестный исполнитель",
      album: row[al] || "Импортированная коллекция",
      duration: Math.max(0, Number(row[du]) / 1000 || 0),
      source: "Spotify",
      cover,
    }));
}
function plistValue(element: Element): unknown {
  if (element.tagName === "dict") {
    const result: Record<string, unknown> = {},
      children = Array.from(element.children);
    for (let i = 0; i < children.length - 1; i += 2)
      result[children[i].textContent || ""] = plistValue(children[i + 1]);
    return result;
  }
  if (element.tagName === "array")
    return Array.from(element.children).map(plistValue);
  if (element.tagName === "integer" || element.tagName === "real")
    return Number(element.textContent);
  return element.textContent || "";
}
function importXML(text: string): Track[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error(
      "Некорректный XML. Экспортируйте медиатеку Apple Music или iTunes заново.",
    );
  const root = doc.querySelector("plist > dict");
  if (!root) throw new Error("Выберите XML медиатеки Apple Music или iTunes.");
  const data = plistValue(root) as {
    Tracks?: Record<string, Record<string, unknown>>;
  };
  return Object.values(data.Tracks || {})
    .filter((t) => t.Name)
    .map((t) => ({
      id: `apple-xml-${hash(`${t.Name}-${t.Artist}-${t.Album}`)}`,
      title: String(t.Name),
      artist: String(t.Artist || "Неизвестный исполнитель"),
      album: String(t.Album || "Импорт Apple Music"),
      duration: Number(t["Total Time"] || 0) / 1000,
      cover,
      source: "Apple Music",
    }));
}
export async function importLibrary(
  file: File,
): Promise<{ track: Track; blob?: Blob }[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv" || ext === "xml") {
    const content = await file.text();
    const tracks = ext === "xml" ? importXML(content) : importCSV(content);
    if (!tracks.length) throw new Error("В этой медиатеке нет песен.");
    return tracks.map((track) => ({ track }));
  }
  if (
    file.type.startsWith("audio/") ||
    /^(mp3|m4a|wav|ogg|flac|aac|opus|aiff|aif|webm)$/.test(ext || "")
  )
    return [await importAudio(file)];
  throw new Error(
    `Формат файла «${file.name}» не поддерживается. Выберите аудио, XML или CSV.`,
  );
}
export function sourceLabel(source: Source) {
  return source === "Local"
    ? "Локальные файлы"
    : source === "Loud"
      ? "LOUD"
      : source;
}
