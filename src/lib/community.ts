import { invoke } from "@tauri-apps/api/core";

export const communityLinks = {
  telegram: "https://t.me/loudplatform",
  github: "https://github.com/Loud-Music/Loud",
} as const;

export type CommunityDestination = keyof typeof communityLinks;

export async function openCommunity(destination: CommunityDestination) {
  await invoke("open_community", { destination });
}
