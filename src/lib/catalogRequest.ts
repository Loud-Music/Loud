import { invoke } from "@tauri-apps/api/core";

export const catalogOrigins = {
  deezer: "https://api.deezer.com",
  audius: "https://api.audius.co",
  wikimedia: "https://commons.wikimedia.org",
  ccmixter: "https://ccmixter.org",
  betterlyrics: "https://api.betterlyrics.org",
  lyricsplus: "https://lyricsplus.binimum.org",
  itunes: "https://itunes.apple.com",
  appleweb: "https://music.apple.com",
  rmmrevival: "https://lyrics.rmmreviv.al",
  amll: "https://api.amll.dev",
  lrcmux: "https://api.lrcmux.dev",
  lrclib: "https://lrclib.net",
  openverse: "https://api.openverse.org",
};
type CatalogAPI = keyof typeof catalogOrigins;
const pending = new Map<string, { at: number; value: Promise<unknown> }>();

async function requestJSON<T>(provider: CatalogAPI, path: string): Promise<T> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)
    return invoke<T>("catalog_json", { provider, path });
  const origin = import.meta.env.DEV
    ? `/catalog-api/${provider}`
    : catalogOrigins[provider];
  const response = await fetch(`${origin}${path}`, {
    signal: AbortSignal.timeout(
      provider === "deezer" && path.startsWith("/search/artist")
        ? 3000
        : provider === "itunes" && path.includes("entity=musicArtist")
          ? 6000
          : provider === "appleweb"
            ? 8000
            : 25000,
    ),
  });
  if (!response.ok) throw new Error(`${provider}: ${response.status}`);
  return response.json();
}
export async function catalogJSON<T>(
  provider: CatalogAPI,
  path: string,
): Promise<T> {
  const key = `${provider}${path}`;
  const old = pending.get(key);
  if (old && Date.now() - old.at < 180000) return old.value as Promise<T>;
  const value = requestJSON<T>(provider, path).catch((error) => {
    pending.delete(key);
    throw error;
  });
  if (pending.size >= 64) pending.delete(pending.keys().next().value!);
  pending.set(key, { at: Date.now(), value });
  return value;
}

export function clearCatalogCache(providers: CatalogAPI[]) {
  for (const key of pending.keys())
    if (providers.some((provider) => key.startsWith(`${provider}/`)))
      pending.delete(key);
}
