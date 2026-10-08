import { readFetch } from "./read-fetch";
import { safeReturnTo } from "./return-to";
import { AUTH_CHANNEL, AUTH_EVENT_KEY, SIGNED_OUT_MESSAGE } from "./session-events";
import { localizedPath, type Locale } from "@/lib/i18n/locale";
import { TERMS_VERSION } from "../../../legal/publication.mjs";

export type AuthUser = {
  id: string;
  email: string | null;
  name: string;
  role?: string;
  authMethod?: "telegram";
  requiresReauthentication?: boolean;
};

export type AuthProviders = { telegram: boolean };

const CSRF_KEY = "otgolosok:account:csrf";
const LAST_USER_KEY = "otgolosok:account:last-user";
const OFFLINE_LOGOUT_KEY = "otgolosok:auth:offline-logout";
let pendingRevoke: Promise<void> | null = null;

async function api(path: string, init?: RequestInit) {
  const csrf = typeof sessionStorage === "undefined" ? "" : sessionStorage.getItem(CSRF_KEY) ?? "";
  const response = await ((!init?.method || init.method === "GET") ? readFetch : fetch)(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000), ...init,
    headers: { "Content-Type": "application/json", ...(init?.method && !["GET","HEAD"].includes(init.method) && csrf ? {"X-CSRF-Token":csrf} : {}), ...(init?.headers ?? {}) } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value?.message ?? value?.error?.message ?? "Не удалось выполнить запрос."), { status: response.status, code: typeof value?.error?.code === "string" ? value.error.code : typeof value?.code === "string" ? value.code : null });
  return value;
}
export async function getSession(): Promise<AuthUser | null> {
  if(typeof localStorage!=="undefined"&&localStorage.getItem(OFFLINE_LOGOUT_KEY))return null;
  const response = await readFetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok && response.status !== 401) throw new Error("Не удалось проверить вход. Попробуйте ещё раз.");
  if (!response.ok) {
    localStorage.removeItem(LAST_USER_KEY);
    return null;
  }
  const value=await response.json();
  if(value.csrfToken)sessionStorage.setItem(CSRF_KEY,value.csrfToken);
  if(value.user?.id) localStorage.setItem(LAST_USER_KEY,value.user.id); else localStorage.removeItem(LAST_USER_KEY);
  return value.user ?? null;
}
export const getLastUserId = () => typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_USER_KEY);
async function completeAuthentication(path:string,body:Record<string,string|boolean>,message:string){try{await flushPendingSignOut();const value=await api(path,{method:"POST",body:JSON.stringify(body)});await getSession();return value;}catch(error){const code=(error as {code?:string}).code;throw new Error(code==="LEGAL_UNAVAILABLE"?"Регистрация временно недоступна.":code==="TERMS_REQUIRED"?"Для регистрации примите актуальные условия использования.":message,{cause:error});}}
export const signInWithPassword = (email:string,password:string) => completeAuthentication("/api/auth/sign-in/email",{email,password},"Неверный email или пароль.");
export const signUpWithPassword = (name:string,email:string,password:string,termsAccepted:boolean) => completeAuthentication("/api/auth/sign-up/email",{name,email,password,termsAccepted,termsVersion:TERMS_VERSION},"Не удалось создать аккаунт. Возможно, этот email уже используется.");

export async function getAuthProviders(): Promise<AuthProviders> {
  const value = await api("/api/auth/providers");
  if (typeof value?.telegram !== "boolean") throw new Error("Сервер вернул неожиданный ответ.");
  return { telegram: value.telegram };
}

export async function getTelegramAuthorizationUrl(returnTo: string | null, locale: Locale, origin: string, termsAccepted = false): Promise<string> {
  await flushPendingSignOut();
  const callbackURL = safeReturnTo(returnTo, origin, locale);
  const errorParameters = new URLSearchParams({ telegram_error: "1", returnTo: callbackURL });
  const errorCallbackURL = `${localizedPath("/login", locale)}?${errorParameters.toString()}`;
  const value = await api("/api/auth/sign-in/social", {
    method: "POST",
    body: JSON.stringify({ provider: "telegram", callbackURL, errorCallbackURL, disableRedirect: true, termsAccepted, termsVersion: TERMS_VERSION }),
  });
  let authorizationURL: URL;
  try { authorizationURL = new URL(value?.url); }
  catch { throw new Error("Сервер вернул неожиданный адрес Telegram."); }
  if (authorizationURL.origin !== "https://oauth.telegram.org" || authorizationURL.pathname !== "/auth" || authorizationURL.username || authorizationURL.password) {
    throw new Error("Сервер вернул неожиданный адрес Telegram.");
  }
  return authorizationURL.href;
}

function announceSignOut(){try{new BroadcastChannel(AUTH_CHANNEL).postMessage(SIGNED_OUT_MESSAGE);}catch{/* Storage remains the cross-tab fallback. */}localStorage.setItem(AUTH_EVENT_KEY,String(Date.now()));}
async function revokePending(){
  if (pendingRevoke) return pendingRevoke;
  const marker = localStorage.getItem(OFFLINE_LOGOUT_KEY);
  if (!marker) return;
  const task = (async () => {
    await api("/api/auth/sign-out",{method:"POST",body:"{}"});
    if (localStorage.getItem(OFFLINE_LOGOUT_KEY) === marker) localStorage.removeItem(OFFLINE_LOGOUT_KEY);
  })();
  pendingRevoke = task;
  try { await task; }
  finally { if (pendingRevoke === task) pendingRevoke = null; }
}
async function flushPendingSignOut(){
  for (;;) {
    const activeRevoke = pendingRevoke;
    if (activeRevoke) {
      await activeRevoke;
      if (pendingRevoke === activeRevoke) pendingRevoke = null;
      continue;
    }
    if (!localStorage.getItem(OFFLINE_LOGOUT_KEY)) return;
    await revokePending();
  }
}
if(typeof window!=="undefined"){addEventListener("online",()=>void flushPendingSignOut().catch(()=>{}));void flushPendingSignOut().catch(()=>{});}
export const signOut = async () => {
  try {
    const result = await api("/api/auth/sign-out", { method: "POST", body: "{}" });
    localStorage.removeItem(OFFLINE_LOGOUT_KEY);
    return result;
  } catch (error) {
    localStorage.setItem(OFFLINE_LOGOUT_KEY, String(Date.now()));
    throw new Error("Локальный выход выполнен. Сервер отзовёт сессию после восстановления сети.", { cause: error });
  } finally {
    sessionStorage.removeItem(CSRF_KEY);
    localStorage.removeItem(LAST_USER_KEY);
    announceSignOut();
  }
};
export const signOutEverywhere = async () => {const result=await api("/api/auth/revoke-sessions", { method:"POST", body:"{}" });localStorage.removeItem(LAST_USER_KEY);announceSignOut();return result;};
export const csrfHeaders = (): Record<string,string> => {const token=typeof sessionStorage==="undefined"?null:sessionStorage.getItem(CSRF_KEY);return token?{"X-CSRF-Token":token}:{};};
export { api as accountApi };
