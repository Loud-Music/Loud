import { errorMessage } from "../lib/errors";
import { useState } from "react";
import { ArrowLeft, LoaderCircle, Music2, Plus, UserRound } from "lucide-react";
import App from "../App";
import {
  createAccount,
  currentAccount,
  listAccounts,
  signIn,
  signOut,
} from "../lib/accounts";
import type { LocalAccount } from "../lib/accounts";
import { useLibraryAccount } from "../lib/library";
import { getCurrentWindow } from "@tauri-apps/api/window";

const initial = currentAccount();
if (initial) useLibraryAccount(initial.id);

export default function AccountGate() {
  const [account, setAccount] = useState(initial);
  const [accounts, setAccounts] = useState(listAccounts);
  const [creating, setCreating] = useState(accounts.length === 0);
  const [selected, setSelected] = useState<LocalAccount | undefined>(
    accounts[0],
  );
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const next = creating ? await createAccount(name, password) : selected;
      if (!next) return;
      if (!creating) await signIn(next, password);
      useLibraryAccount(next.id);
      setAccounts(listAccounts());
      setAccount(next);
      setPassword("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (account) return <App account={account} onSwitchAccount={signOut} />;
  return (
    <main className="account-screen" data-tauri-drag-region>
      {"__TAURI_INTERNALS__" in window && (
        <div className="account-window-controls">
          <button
            aria-label="Свернуть"
            onClick={() => void getCurrentWindow().minimize()}
          >
            −
          </button>
          <button
            aria-label="Закрыть"
            onClick={() => void getCurrentWindow().close()}
          >
            ×
          </button>
        </div>
      )}
      <form
        className="account-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="account-brand">
          <Music2 size={25} /> Loud
        </div>
        <h1>{creating ? "Создать локальный профиль" : "Выберите профиль"}</h1>
        <p>
          {creating
            ? "Медиатека и настройки профиля будут храниться на этом устройстве."
            : "Выберите профиль, чтобы открыть медиатеку."}
        </p>
        {creating ? (
          <label>
            Имя
            <input
              autoFocus
              aria-label="Имя профиля"
              autoComplete="username"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ваше имя"
              required
            />
          </label>
        ) : (
          <div className="account-list">
            {accounts.map((item) => (
              <button
                key={item.id}
                type="button"
                className={selected?.id === item.id ? "selected" : ""}
                onClick={() => {
                  setSelected(item);
                  setPassword("");
                  setError("");
                }}
              >
                <span className="account-avatar">
                  <UserRound size={21} />
                </span>
                <strong>{item.name}</strong>
                <small>
                  {item.passwordHash ? "Защищён паролем" : "Локальный профиль"}
                </small>
              </button>
            ))}
          </div>
        )}
        {(creating || selected?.passwordHash) && (
          <label>
            {creating ? "Пароль (необязательно)" : "Пароль"}
            <input
              type="password"
              aria-label="Пароль профиля"
              autoComplete={creating ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={creating ? "Не менее 6 символов" : "Введите пароль"}
            />
          </label>
        )}
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button button-accent account-submit"
          type="submit"
          disabled={busy || (creating && !name.trim())}
        >
          {busy ? <LoaderCircle size={17} className="spin" /> : null}
          {creating ? "Создать профиль" : "Продолжить"}
        </button>
        {accounts.length > 0 && (
          <button
            className="text-button account-alternate"
            type="button"
            onClick={() => {
              setCreating(!creating);
              setPassword("");
              setError("");
            }}
          >
            {creating ? <ArrowLeft size={15} /> : <Plus size={15} />}
            {creating ? "К профилям" : "Добавить профиль"}
          </button>
        )}
      </form>
    </main>
  );
}
