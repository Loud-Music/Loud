export interface Artist {
  id: number;
  name: string;
  picture_xl?: string;
  banner?: string;
  bio?: string;
  description?: string;
  genres?: string[];
  links?: { label: string; url: string }[];
  visibility?: string;
  banned?: boolean;
  deleted?: boolean;
}
export interface Track {
  id: number;
  title: string;
  artistIds: number[];
  releaseId: number;
  audio: string;
  cover?: string;
  duration: number;
  format: string;
  sampleRate?: number;
  bitDepth?: number;
  visibility?: string;
  banned?: boolean;
  lrc?: string;
  lyricsSource?: string;
}
export interface Release {
  id: number;
  title: string;
  artistIds: number[];
  trackIds: number[];
  cover: string;
  release_date: string;
  record_type: string;
  publishAt?: string;
  presave?: boolean;
  visibility?: string;
}
export interface ReleaseItem {
  release: Release;
  tracks: Track[];
  status: "draft" | "published" | "scheduled";
}
export interface Catalog {
  distributor: { id: number; name: string };
  artists: Artist[];
  releases: ReleaseItem[];
}
function requestError(status: number, error?: string) {
  if (error && /[а-яё]/i.test(error)) return error;
  if (error?.includes("timestamps exceed"))
    return "Метки времени LRC выходят за длительность трека.";
  if (error?.includes("LRC must contain"))
    return "В LRC нужны метки времени, например [00:12.50].";
  if (error?.includes("LRC exceeds"))
    return "LRC должен быть меньше 200 КБ и содержать корректный текст.";
  if (error?.includes("FLAC"))
    return "Нужен полный FLAC-мастер с корректными метаданными.";
  if (status === 401 || status === 403)
    return "API не подтвердил доступ. Проверь файл ключа CLOUDED.D.";
  if (status === 404)
    return "Запись не найдена или недоступна этому дистрибьютору.";
  if (status === 413)
    return "Файл слишком большой: FLAC до 200 МиБ, обложка до 8 МиБ.";
  if (status >= 500)
    return "API временно недоступен. Введённые данные остались в форме.";
  return "Не удалось сохранить данные. Проверь обязательные поля, файлы и дату выхода.";
}
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: {
      "X-Loud-Panel": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(requestError(response.status, value.error));
  return value as T;
}
export function media(path?: string) {
  return path ? `/api/media?${new URLSearchParams({ path })}` : undefined;
}
export function upload(
  file: File,
  progress: (value: number) => void,
  signal?: AbortSignal,
): Promise<{ path: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      "POST",
      `/api/uploads?${new URLSearchParams({ filename: file.name })}`,
    );
    request.setRequestHeader("X-Loud-Panel", "1");
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.timeout = 300000;
    const abort = () => request.abort();
    signal?.addEventListener("abort", abort, { once: true });
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    request.onerror =
      request.ontimeout =
      request.onabort =
        () => {
          signal?.removeEventListener("abort", abort);
          reject(new Error("Загрузка прервана. Повтори отправку файла."));
        };
    request.onload = () => {
      signal?.removeEventListener("abort", abort);
      let result: { path?: string; error?: string } = {};
      try {
        result = JSON.parse(request.responseText);
      } catch {}
      if (request.status < 200 || request.status >= 300 || !result.path)
        reject(new Error(requestError(request.status, result.error)));
      else {
        progress(100);
        resolve({ path: result.path });
      }
    };
    request.send(file);
  });
}
export const statusLabel = (item: ReleaseItem) =>
  item.status === "draft"
    ? "Черновик"
    : item.status === "scheduled"
      ? "Запланирован"
      : "Опубликован";
