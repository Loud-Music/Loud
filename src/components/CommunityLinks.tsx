import { useState } from "react";
import { ExternalLink, GitHub, Star, Telegram } from "../icons";
import {
  communityLinks,
  openCommunity,
  type CommunityDestination,
} from "../lib/community";
import "../community.css";

export default function CommunityLinks({
  detailed = false,
}: {
  detailed?: boolean;
}) {
  const [error, setError] = useState("");
  return (
    <div
      className={`community-links ${detailed ? "community-links-detailed" : ""}`}
    >
      {(["telegram", "github"] as const).map(
        (destination: CommunityDestination) => {
          const Icon =
            destination === "telegram" ? Telegram : detailed ? GitHub : Star;
          const label =
            destination === "telegram"
              ? "Telegram"
              : detailed
                ? "GitHub"
                : "Поставить звезду";
          return (
            <a
              key={destination}
              href={communityLinks[destination]}
              target="_blank"
              rel="noopener noreferrer"
              className="community-link"
              onClick={async (event) => {
                if (!("__TAURI_INTERNALS__" in window)) return;
                event.preventDefault();
                setError("");
                try {
                  await openCommunity(destination);
                } catch {
                  setError(
                    "Не удалось открыть браузер. Скопируйте адрес ссылки и откройте его вручную.",
                  );
                }
              }}
            >
              <Icon size={detailed ? 24 : 18} />
              <span className="community-link-copy">
                <strong>{label}</strong>
                {detailed && (
                  <span>
                    {destination === "telegram"
                      ? "Новости · @loudplatform"
                      : "Исходный код · Loud-Music/Loud"}
                  </span>
                )}
              </span>
              {detailed && <ExternalLink size={15} />}
            </a>
          );
        },
      )}
      {error && (
        <p className="community-link-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
