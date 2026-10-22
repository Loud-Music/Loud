import { check, type Update } from "@tauri-apps/plugin-updater";

let available: Update | null = null;
let pending: Promise<Update | null> | undefined;
export const currentUpdate = () => available;

export function checkUpdates() {
  if (!("__TAURI_INTERNALS__" in window)) return Promise.resolve(null);
  if (pending) return pending;
  pending = check({ timeout: 10000 })
    .then(async (update) => {
      if (available) await available.close();
      available = update;
      return update;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
