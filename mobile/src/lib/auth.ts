// Accounts, the same way the website does it: Neon Auth through our /auth proxy keeps the session in a cookie,
// and /auth/token turns it into a short-lived token for our own API.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, ApiError, BASE, loadIdentity, savedTabs, saveIdentity, type Identity } from "@/lib/api";

const FLAG = "quicktab:signed-in"; // only for what to show; the session itself is the cookie
const JAR = "quicktab:session";
const TOKEN_MS = 10 * 60 * 1000; // Neon's last 15 minutes
let token: string | null = null, tokenAt = 0;

// The session cookie, kept here rather than in the phone's cookie store: Android's drops Neon's (it's Partitioned).
let jar: Record<string, string> | null = null;
const loadJar = async () => (jar ??= JSON.parse((await AsyncStorage.getItem(JAR).catch(() => null)) || "{}") as Record<string, string>);

// "a=1; Path=/; Expires=Sun, 15 Nov 2026 ..., b=2; Max-Age=0" -> sets a, deletes b. Only a name right after the
// start or a comma counts, so attributes and the comma inside a date don't.
export function takeCookies(header: string, into: Record<string, string>) {
  for (const part of header.split(/,\s*(?=[^;,=\s]+=)/)) {
    const [, name, value] = part.match(/^\s*([^=;\s]+)=([^;]*)/) || [];
    if (!name) continue;
    if (!value || /max-age=0\b/i.test(part)) delete into[name];
    else into[name] = value;
  }
  return into;
}

// Neon checks where a request comes from, and an app has no page to come from: say it's the website.
async function authApi<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const cookies = await loadJar();
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  let res: Response;
  try {
    res = await fetch(`${BASE}/auth/${path}`, {
      method, credentials: "omit", body: body ? JSON.stringify(body) : undefined,
      headers: { "Content-Type": "application/json", Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    });
  } catch {
    throw new ApiError("No connection. Check your internet and try again.", 0);
  }
  const set = res.headers.get("set-cookie");
  if (set) await AsyncStorage.setItem(JAR, JSON.stringify(takeCookies(set, cookies)));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message || data.detail || "Something went wrong. Try again.", res.status);
  return data as T;
}

export type Me = { email: string; name: string; upi_id: string | null };

export const isSignedIn = async () => !!(await AsyncStorage.getItem(FLAG).catch(() => null));

export async function signIn(email: string, password: string) {
  await authApi("POST", "sign-in/email", { email, password });
  await AsyncStorage.setItem(FLAG, "1");
}

export async function signUp(name: string, email: string, password: string) {
  await authApi("POST", "sign-up/email", { name, email, password });
  await AsyncStorage.setItem(FLAG, "1");
}

export async function forgotPassword(email: string) {
  await authApi("POST", "request-password-reset", { email, redirectTo: `${BASE}/login` }); // the reset itself happens on the website
}

async function forget() {
  token = null;
  jar = {};
  await AsyncStorage.multiRemove([FLAG, JAR]);
}

export async function signOut() {
  await authApi("POST", "sign-out", {}).catch(() => {}); // offline: the phone forgets you anyway
  await forget();
}

// Like the website: Neon checks the password and deletes the login, then our side lets go of everything else.
export async function deleteAccount(password: string) {
  await authToken(true); // the session ends with the login, so take the token for our own delete first
  await authApi("POST", "delete-user", { password });
  await authed("DELETE", "/api/me");
  await forget();
}

async function authToken(fresh: boolean) {
  if (!fresh && token && Date.now() - tokenAt < TOKEN_MS) return token;
  token = (await authApi<{ token?: string }>("GET", "token").catch(() => ({ token: undefined }))).token || null;
  tokenAt = Date.now();
  return token;
}

// api() as the signed-in user. A token can go stale before it expires, so a 401 gets one fresh try; a second
// 401 means the session is gone, and the phone forgets it.
export async function authed<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const send = async (fresh: boolean) => api<T>(method, path, body, { ...headers, Authorization: `Bearer ${await authToken(fresh)}` });
  try {
    return await send(false);
  } catch (err) {
    if ((err as ApiError).status !== 401) throw err;
    try {
      return await send(true);
    } catch (again) {
      if ((again as ApiError).status === 401) await AsyncStorage.removeItem(FLAG);
      throw again;
    }
  }
}

// Signed in, a tab or group is read as you: groups need it, tabs don't mind.
export async function accountHeaders(): Promise<Record<string, string>> {
  const t = (await isSignedIn()) && (await authToken(false));
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Who you are in a tab goes on your account, so it's on your Home on every device. A protected tab needs your session.
export const claimTab = (slug: string, id: Identity) =>
  authed("POST", `/api/splits/${slug}/claim`, { member_id: id.me }, id.token ? { "X-Member-Token": id.token } : {});

export type Listed = {
  kind: "group" | "tab"; slug: string; name: string; ended: boolean; spent: number; balance: number; members: string[];
  expires_at?: number; hours?: number; me?: number; token?: string | null; admin_token?: string | null;
};

// Signed in, Home is your account's: your groups and your tabs. Tabs this phone opened before you signed in join it
// first, and tabs opened elsewhere teach this phone who you are in them.
export async function myList(): Promise<Listed[]> {
  const [groups, first] = await Promise.all([authed<Listed[]>("GET", "/api/groups"), authed<Listed[]>("GET", "/api/tabs")]);
  let tabs = first;
  const linked = new Set(tabs.map((t) => t.slug));
  const local = (await savedTabs()).filter((t) => !linked.has(t.slug) && t.me != null);
  if (local.length) {
    await Promise.allSettled(local.map((t) => claimTab(t.slug, t)));
    tabs = await authed<Listed[]>("GET", "/api/tabs");
  }
  for (const t of tabs) {
    if ((await loadIdentity(t.slug)).me !== t.me) await saveIdentity(t.slug, { me: t.me, token: t.token, adminToken: t.admin_token });
  }
  return [...groups.map((g) => ({ ...g, kind: "group" as const })), ...tabs.map((t) => ({ ...t, kind: "tab" as const, hours: Math.max(0, Math.round((t.expires_at! - Date.now() / 1000) / 3600)) }))];
}
