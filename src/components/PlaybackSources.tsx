import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import CheckField from "./CheckField";
import { playbackSources, savePlaybackSources } from "../lib/playbackSources";

function endpointOrigin(endpoint: string) {
  try {
    return new URL(endpoint).origin;
  } catch {
    return undefined;
  }
}

export default function PlaybackSources() {
  const [config, setConfig] = useState(playbackSources);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="prefs-group">
      <h3>Дополнительные источники</h3>
      <div className="prefs-group-body">
        <div className="prefs-row">
          <div className="prefs-row-copy">
            <strong>JioSaavn · Rhythmax</strong>
            <p>
              Резервный поиск полной записи. Доступность зависит от каталога.
            </p>
          </div>
          <CheckField
            aria-label="Использовать JioSaavn"
            checked={config.jiosaavn}
            onCheckedChange={(jiosaavn) => {
              const next = { ...config, jiosaavn };
              setConfig(next);
              savePlaybackSources({ ...playbackSources(), jiosaavn });
            }}
          />
        </div>
        <div className="prefs-source-fields">
          <strong>cobalt</strong>
          <p className="prefs-note">
            Подключите свой API-инстанс или сервер, к которому вам предоставили
            доступ. Пустой адрес отключает источник.
          </p>
          <label>
            <span>Адрес API</span>
            <input
              type="url"
              placeholder="http://127.0.0.1:9000/"
              autoComplete="off"
              maxLength={2000}
              disabled={busy}
              value={config.cobalt.endpoint}
              onChange={(event) => {
                const endpoint = event.target.value;
                const origin = endpointOrigin(endpoint);
                setConfig((previous) => ({
                  ...previous,
                  cobalt: {
                    endpoint,
                    apiKey:
                      origin &&
                      origin === endpointOrigin(previous.cobalt.endpoint)
                        ? previous.cobalt.apiKey
                        : "",
                  },
                }));
                setStatus("");
                setError("");
              }}
            />
          </label>
          <label>
            <span>Ключ API, если требуется</span>
            <input
              type="password"
              autoComplete="off"
              maxLength={4096}
              disabled={busy}
              value={config.cobalt.apiKey}
              onChange={(event) => {
                setConfig({
                  ...config,
                  cobalt: { ...config.cobalt, apiKey: event.target.value },
                });
                setStatus("");
                setError("");
              }}
            />
          </label>
          <div className="prefs-source-actions">
            <Button
              className="prefs-button"
              disabled={busy}
              onClick={() => {
                setStatus("");
                setError("");
                const endpoint = config.cobalt.endpoint.trim();
                if (endpoint) {
                  try {
                    const url = new URL(endpoint);
                    if (
                      (url.protocol !== "https:" &&
                        !(
                          url.protocol === "http:" &&
                          ["localhost", "127.0.0.1", "[::1]"].includes(
                            url.hostname,
                          )
                        )) ||
                      url.username ||
                      url.password ||
                      url.hash ||
                      url.search
                    )
                      throw new Error();
                  } catch {
                    setError(
                      "Укажите HTTPS-адрес API или локальный HTTP-адрес.",
                    );
                    return;
                  }
                }
                const next = {
                  ...config,
                  cobalt: {
                    endpoint,
                    apiKey: endpoint ? config.cobalt.apiKey.trim() : "",
                  },
                };
                setConfig(next);
                savePlaybackSources(next);
                setStatus(endpoint ? "Источник сохранён." : "cobalt отключён.");
              }}
            >
              Сохранить
            </Button>
            <Button
              className="prefs-button"
              disabled={
                busy ||
                !config.cobalt.endpoint.trim() ||
                !("__TAURI_INTERNALS__" in window)
              }
              onClick={async () => {
                setBusy(true);
                setStatus("");
                setError("");
                try {
                  const reply = await invoke<{ version: string }>(
                    "cobalt_status",
                    {
                      endpoint: config.cobalt.endpoint,
                      apiKey: config.cobalt.apiKey,
                    },
                  );
                  setStatus(
                    `API отвечает · cobalt ${reply.version}. Для подключения сохраните настройки.`,
                  );
                } catch (reason) {
                  setError(String(reason));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Проверяем…" : "Проверить API"}
            </Button>
          </div>
          {status && (
            <p className="prefs-note" role="status">
              {status}
            </p>
          )}
          {error && (
            <p className="prefs-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
