import React from "react";
import ReactDOM from "react-dom/client";
import { initializePersistence, flushPersistence } from "./lib/persistence";
import "./styles.css";
import "./artist.css";
import "./layout.css";
import "./wave.css";

document.documentElement.dataset.platform =
  "__TAURI_INTERNALS__" in window ? "desktop" : "web";

async function boot() {
  try {
    await initializePersistence();
    if ("__TAURI_INTERNALS__" in window) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      await window.onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          await flushPersistence();
          await window.destroy();
        } catch (error) {
          globalThis.window.dispatchEvent(
            new CustomEvent("loud-storage-error", { detail: String(error) }),
          );
        }
      });
    }
    const { default: AccountGate } = await import("./components/AccountGate");
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <AccountGate />
      </React.StrictMode>,
    );
    if ("__TAURI_INTERNALS__" in window) {
      setTimeout(() => {
        void import("./lib/updates")
          .then(({ checkUpdates }) => checkUpdates())
          .catch(() => {});
      }, 15000);
    }
  } catch (error) {
    const root = document.getElementById("root")!;
    root.textContent = `Не удалось открыть сохранённый профиль. Данные не перезаписаны. ${String(error)}`;
    const retry = document.createElement("button");
    retry.textContent = "Повторить";
    retry.onclick = () => location.reload();
    root.appendChild(retry);
  }
}
window.addEventListener("loud-storage-error", () => {
  let banner = document.getElementById("storage-error");
  if (banner) return;
  banner = document.createElement("div");
  banner.id = "storage-error";
  banner.setAttribute("role", "alert");
  banner.style.cssText =
    "position:fixed;bottom:90px;left:24px;right:24px;padding:16px;background:#552331;color:white;z-index:10000";
  banner.textContent =
    "Не удалось сохранить изменения в AppData. Проверьте свободное место и перезапустите приложение.";
  document.body.appendChild(banner);
});
void boot();
