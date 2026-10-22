import { persistentGet, persistentSet, flushPersistence } from "./persistence";
export interface LocalAccount {
  id: string;
  name: string;
  created: number;
  salt?: string;
  passwordHash?: string;
}
const accountsKey = "loud:accounts:v1";
const sessionKey = "loud:account-session:v1";
export function listAccounts(): LocalAccount[] {
  try {
    const data = JSON.parse(persistentGet(accountsKey) || "[]");
    return Array.isArray(data)
      ? data.filter(
          (account) =>
            account &&
            typeof account.id === "string" &&
            typeof account.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}
export function currentAccount() {
  const id =
    sessionStorage.getItem(sessionKey) || persistentGet("loud:last-account");
  return listAccounts().find(
    (account) =>
      account.id === id &&
      (!account.passwordHash || sessionStorage.getItem(sessionKey) === id),
  );
}
function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function passwordHash(password: string, salt: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: new TextEncoder().encode(salt),
        iterations: 210000,
      },
      material,
      256,
    ),
  );
}
export async function createAccount(
  name: string,
  password: string,
): Promise<LocalAccount> {
  name = name.trim();
  if (!name || name.length > 40)
    throw new Error("Имя должно содержать от 1 до 40 символов.");
  const accounts = listAccounts();
  if (
    accounts.some(
      (account) =>
        account.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    throw new Error("Профиль с таким именем уже существует.");
  if (password && password.length < 6)
    throw new Error("Пароль должен содержать не менее 6 символов.");
  const account: LocalAccount = {
    id: accounts.length === 0 ? "legacy" : crypto.randomUUID(),
    name,
    created: Date.now(),
  };
  if (password) {
    account.salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
    account.passwordHash = await passwordHash(password, account.salt);
  }
  persistentSet(accountsKey, JSON.stringify([...accounts, account]));
  persistentSet("loud:last-account", account.id);
  await flushPersistence();
  sessionStorage.setItem(sessionKey, account.id);
  return account;
}
export async function signIn(account: LocalAccount, password: string) {
  if (
    account.passwordHash &&
    (await passwordHash(password, account.salt!)) !== account.passwordHash
  )
    throw new Error("Неверный пароль.");
  persistentSet("loud:last-account", account.id);
  await flushPersistence();
  sessionStorage.setItem(sessionKey, account.id);
}
export async function signOut() {
  persistentSet("loud:last-account", "");
  await flushPersistence();
  sessionStorage.removeItem(sessionKey);
  document.querySelectorAll("audio").forEach((audio) => audio.pause());
  if ("__TAURI_INTERNALS__" in window)
    await invoke("exclusive_control", { action: "stop" }).catch(() => {});
  location.reload();
}
import { invoke } from "@tauri-apps/api/core";
