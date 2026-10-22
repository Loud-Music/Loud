import { useEffect, useState } from "react";
import { discordConfig, saveDiscordConfig } from "../lib/useDiscordPresence";
export default function DiscordSettings() {
  const [config, setConfig] = useState(discordConfig);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const receive = (event: Event) =>
      setStatus((event as CustomEvent<string>).detail);
    window.addEventListener("loud-discord-status", receive);
    return () => window.removeEventListener("loud-discord-status", receive);
  }, []);
  return (
    <section className="prefs-group">
      <h3>Discord</h3>
      <div className="prefs-group-body">
        <div className="prefs-row">
          <div className="prefs-row-copy">
            <strong>Показывать, что я слушаю</strong>
            <p>Трек, исполнитель, обложка и время воспроизведения</p>
          </div>
          <input
            type="checkbox"
            aria-label="Discord Rich Presence"
            checked={config.enabled}
            disabled={!/^\d{17,20}$/.test(config.applicationId)}
            onChange={(e) => {
              const next = { ...config, enabled: e.target.checked };
              setConfig(next);
              saveDiscordConfig(next);
            }}
          />
        </div>
      </div>
      <p className="prefs-note" role="status">
        {!config.applicationId
          ? "Подключение станет доступно после настройки Discord-приложения Loud."
          : status || "Нужен запущенный Discord на компьютере."}
      </p>
    </section>
  );
}
