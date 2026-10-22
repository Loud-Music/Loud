import { invoke } from "@tauri-apps/api/core";

type Color = [number, number, number];
export type CoverPalette = [Color, Color, Color];
export const neutralPalette: CoverPalette = [
  [0.18, 0.19, 0.22],
  [0.3, 0.31, 0.34],
  [0.43, 0.44, 0.47],
];
const cache = new Map<string, Promise<CoverPalette>>();

function image(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const picture = new Image();
    const timer = setTimeout(() => {
      picture.src = "";
      reject(new Error("Обложка не отвечает"));
    }, 5000);
    picture.crossOrigin = "anonymous";
    picture.onload = () => {
      clearTimeout(timer);
      picture.onload = null;
      picture.onerror = null;
      resolve(picture);
    };
    picture.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Не удалось прочитать обложку"));
    };
    picture.src = source;
  });
}

function extract(picture: HTMLImageElement): CoverPalette {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 40;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return neutralPalette;
  context.drawImage(picture, 0, 0, 40, 40);
  const { data } = context.getImageData(0, 0, 40, 40);
  const bins = new Map<number, { color: Color; count: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 180) continue;
    const key =
      (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    const bin = bins.get(key) || { color: [0, 0, 0], count: 0 };
    bin.count++;
    for (let channel = 0; channel < 3; channel++)
      bin.color[channel] += data[i + channel] / 255;
    bins.set(key, bin);
  }
  const colors = [...bins.values()].map((bin) => {
    const color = bin.color.map((value) => value / bin.count) as Color;
    const high = Math.max(...color),
      low = Math.min(...color);
    return { color, weight: bin.count * (0.25 + high - low), light: high };
  });
  const usable = colors.filter((bin) => bin.light > 0.08 && bin.light < 0.96);
  const ranked = (usable.length >= 3 ? usable : colors)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 48);
  if (!ranked.length) return neutralPalette;
  const chosen = [ranked[0].color];
  const distance = (a: Color, b: Color) =>
    a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0);
  while (chosen.length < 3) {
    let best = ranked[0],
      score = -1;
    for (const candidate of ranked) {
      const separation = Math.min(
        ...chosen.map((color) => distance(color, candidate.color)),
      );
      const value = separation * Math.sqrt(candidate.weight);
      if (value > score) {
        best = candidate;
        score = value;
      }
    }
    chosen.push(
      score > 0.01
        ? best.color
        : (chosen[0].map(
            (value) => value * (chosen.length === 1 ? 0.65 : 1.15),
          ) as Color),
    );
  }
  return chosen.map(
    (color) =>
      color.map((value) => Math.min(1, Math.max(0.025, value))) as Color,
  ) as CoverPalette;
}

export function coverPalette(source: string): Promise<CoverPalette> {
  if (!source) return Promise.resolve(neutralPalette);
  const cached = cache.get(source);
  if (cached) return cached;
  const request = (async () => {
    try {
      return extract(await image(source));
    } catch (error) {
      if (!("__TAURI_INTERNALS__" in window) || !source.startsWith("https://"))
        throw error;
      const data = await invoke<{ mime: string; data: string }>(
        "artwork_image",
        { url: source },
      );
      return extract(await image(`data:${data.mime};base64,${data.data}`));
    }
  })().catch((error) => {
    cache.delete(source);
    throw error;
  });
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(source, request);
  return request;
}
