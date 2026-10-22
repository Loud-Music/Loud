import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readSetting, saveSetting, trackArtists, type Track } from "./library";
type DiscordConfig = { enabled: boolean; applicationId: string };
const builtIn =
  import.meta.env.VITE_DISCORD_APPLICATION_ID || "1561804997149196409";
export const discordConfig = (): DiscordConfig => ({
  ...readSetting("discord:v1", { enabled: true, applicationId: builtIn }),
  applicationId: builtIn,
});
export function saveDiscordConfig(config: DiscordConfig) {
  saveSetting("discord:v1", config);
  window.dispatchEvent(new Event("loud-discord-config"));
}
function presenceActivity(
  track: Track,
  playing: boolean,
  position: number,
  duration: number,
  now = Date.now(),
) {
  if (!playing || !track.id) return null;
  const start = Math.floor(now / 1000 - Math.max(0, position));
  return {
    type: 2,
    details: track.title.slice(0, 128),
    state: trackArtists(track).join(", ").slice(0, 128),
    timestamps: {
      start,
      ...(duration > 0 ? { end: start + Math.ceil(duration) } : {}),
    },
    ...(track.cover.startsWith("https://")
      ? {
          assets: {
            large_image: track.cover,
            large_text: track.album.slice(0, 128),
          },
        }
      : {}),
  };
}
export function useDiscordPresence(
  track: Track,
  playing: boolean,
  position: number,
  duration: number,
) {
  const [config, setConfig] = useState(discordConfig);
  const latest = useRef({ track, playing, position, duration });
  latest.current = { track, playing, position, duration };
  useEffect(() => {
    const refresh = () => setConfig(discordConfig());
    window.addEventListener("loud-discord-config", refresh);
    return () => window.removeEventListener("loud-discord-config", refresh);
  }, []);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let stopped = false;
    const update = async () => {
      const value = latest.current;
      try {
        const status = await invoke<string>("discord_presence", {
          update: {
            applicationId: config.enabled ? config.applicationId : "",
            activity: config.enabled
              ? presenceActivity(
                  value.track,
                  value.playing,
                  value.position,
                  value.duration,
                )
              : null,
          },
        });
        if (!stopped)
          window.dispatchEvent(
            new CustomEvent("loud-discord-status", { detail: status }),
          );
      } catch (error) {
        if (!stopped)
          window.dispatchEvent(
            new CustomEvent("loud-discord-status", { detail: String(error) }),
          );
      }
    };
    void update();
    const timer = window.setInterval(() => void update(), 15000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [config, track.id, playing]);
}
