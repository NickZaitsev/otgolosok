export type AuthUser = { id: string; email: string; name: string };
const CSRF_KEY = "otgolosok:account:csrf";

async function api(path: string, init?: RequestInit) {
  const csrf = typeof sessionStorage === "undefined" ? "" : sessionStorage.getItem(CSRF_KEY) ?? "";
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init,
    headers: { "Content-Type": "application/json", ...(init?.method && !["GET","HEAD"].includes(init.method) && csrf ? {"X-CSRF-Token":csrf} : {}), ...(init?.headers ?? {}) } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.message ?? value?.error?.message ?? "Не удалось выполнить запрос.");
  return value;
}
export async function getSession(): Promise<AuthUser | null> {
  if(typeof localStorage!=="undefined"&&localStorage.getItem("otgolosok:auth:offline-logout"))return null;
  const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return null;
  const value=await response.json();if(value.csrfToken)sessionStorage.setItem(CSRF_KEY,value.csrfToken);return value.user ?? null;
}
export const sendLoginCode = (email: string) => api("/api/auth/email-otp/send-verification-otp", { method:"POST", body:JSON.stringify({email,type:"sign-in"}) });
export const verifyLoginCode = async (email: string, otp: string) => {const value=await api("/api/auth/sign-in/email-otp", { method:"POST", body:JSON.stringify({email,otp}) });localStorage.removeItem("otgolosok:auth:offline-logout");await getSession();return value;};
function announceSignOut(){try{new BroadcastChannel("otgolosok:auth").postMessage("signed-out");}catch{/* Optional cross-tab signal. */}localStorage.setItem("otgolosok:auth:event",String(Date.now()));}
async function revokePending(){if(!localStorage.getItem("otgolosok:auth:offline-logout"))return;await api("/api/auth/sign-out",{method:"POST",body:"{}"});localStorage.removeItem("otgolosok:auth:offline-logout");}
if(typeof window!=="undefined"){addEventListener("online",()=>void revokePending().catch(()=>{}));void revokePending().catch(()=>{});}
export const signOut = async () => {announceSignOut();sessionStorage.removeItem(CSRF_KEY);try{const result=await api("/api/auth/sign-out", { method:"POST", body:"{}" });localStorage.removeItem("otgolosok:auth:offline-logout");return result;}catch(error){localStorage.setItem("otgolosok:auth:offline-logout",String(Date.now()));throw new Error("Локальный выход выполнен. Сервер отзовёт сессию после восстановления сети.",{cause:error});}};
export const signOutEverywhere = async () => {const result=await api("/api/auth/revoke-sessions", { method:"POST", body:"{}" });announceSignOut();return result;};
export { api as accountApi };
