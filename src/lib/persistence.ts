import { invoke } from "@tauri-apps/api/core";
const desktop = () => "__TAURI_INTERNALS__" in window;
let values: Record<string, string> = {};
let pending: Promise<void> = Promise.resolve();
export function persistentGet(key: string) {
  return desktop() ? (values[key] ?? null) : localStorage.getItem(key);
}
export function persistentSet(key: string, value: string) {
  if (!desktop()) {
    localStorage.setItem(key, value);
    return;
  }
  values[key] = value;
  const snapshot = { [key]: value };
  pending = pending
    .catch(() => {})
    .then(() => invoke<void>("settings_save", { values: snapshot }));
  void pending.catch((error) =>
    window.dispatchEvent(
      new CustomEvent("loud-storage-error", { detail: String(error) }),
    ),
  );
}
export function flushPersistence() {
  return pending;
}
export async function initializePersistence() {
  if (!desktop()) return;
  values = await invoke<Record<string, string>>("settings_load");
  let imported = false;
  if (!values["loud:accounts:v1"]) {
    for (const [key, value] of Object.entries(localStorage))
      if (key.startsWith("loud:") && values[key] === undefined) {
        values[key] = value;
        imported = true;
      }
  }
  if (imported) await invoke("settings_save", { values });
  const { migrateNativeLibraries } = await import("./library");
  await migrateNativeLibraries();
}
