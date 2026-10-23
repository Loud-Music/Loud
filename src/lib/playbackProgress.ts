import { useSyncExternalStore } from "react";

let progress = 0;
const listeners = new Set<() => void>();

export function getPlaybackProgress() {
  return progress;
}

export function setPlaybackProgress(value: number) {
  if (!Number.isFinite(value) || value === progress) return;
  progress = Math.max(0, value);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlaybackProgress() {
  return useSyncExternalStore(
    subscribe,
    getPlaybackProgress,
    getPlaybackProgress,
  );
}
