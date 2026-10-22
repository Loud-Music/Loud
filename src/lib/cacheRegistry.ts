import { invoke } from "@tauri-apps/api/core";
import { listAccounts } from "./accounts";

let pending: Promise<void> | undefined;
let again = false;
export function syncSavedAudio(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return Promise.resolve();
  again = true;
  if (pending) return pending;
  pending = (async () => {
    while (again) {
      again = false;
      if ("__TAURI_INTERNALS__" in window) {
        const keys = new Set<string>();
        for (const account of listAccounts()) {
          const rows = await invoke<
            {
              track: { downloaded?: boolean; nativeKey?: string; src?: string };
            }[]
          >("library_load", { account: account.id });
          for (const { track } of rows)
            if (track.downloaded) {
              const key =
                track.nativeKey ||
                decodeURIComponent(track.src || "").match(
                  /[\\/]([a-f0-9]{64})(?:\.lucida)?\.(?:flac|mp3|m4a|ogg|opus|webm|wav)(?:$|\?)/i,
                )?.[1];
              if (key && /^[a-f0-9]{64}$/i.test(key)) keys.add(key);
            }
        }
        await invoke("audio_cache_saved", { keys: [...keys] });
        continue;
      }
    }
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
