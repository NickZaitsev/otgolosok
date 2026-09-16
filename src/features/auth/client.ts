export type AuthUser = { id: string; email: string; name: string };

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.message ?? value?.error?.message ?? "Не удалось выполнить запрос.");
  return value;
}
export async function getSession(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return null;
  return (await response.json())?.user ?? null;
}
export const sendLoginCode = (email: string) => api("/api/auth/email-otp/send-verification-otp", { method:"POST", body:JSON.stringify({email,type:"sign-in"}) });
export const verifyLoginCode = (email: string, otp: string) => api("/api/auth/sign-in/email-otp", { method:"POST", body:JSON.stringify({email,otp}) });
function announceSignOut(){try{new BroadcastChannel("otgolosok:auth").postMessage("signed-out");}catch{/* Optional cross-tab signal. */}localStorage.setItem("otgolosok:auth:event",String(Date.now()));}
export const signOut = async () => {const result=await api("/api/auth/sign-out", { method:"POST", body:"{}" });announceSignOut();return result;};
export const signOutEverywhere = async () => {const result=await api("/api/auth/revoke-sessions", { method:"POST", body:"{}" });announceSignOut();return result;};
export { api as accountApi };
