// Accounts, the same way the website does it: Neon Auth through our /auth proxy keeps the session in a cookie
// (the phone's cookie store holds it), and /auth/token turns it into a short-lived token for our own API.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, ApiError, BASE } from "@/lib/api";

const FLAG = "quicktab:signed-in"; // only for what to show; the session itself is the cookie
const TOKEN_MS = 10 * 60 * 1000; // Neon's last 15 minutes
let token: string | null = null, tokenAt = 0;

// Neon checks where a request comes from, and an app has no page to come from: say it's the website.
const authApi = <T = any>(method: string, path: string, body?: unknown) => api<T>(method, `/auth/${path}`, body, { Origin: BASE });

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

export async function signOut() {
  await authApi("POST", "sign-out", {}).catch(() => {}); // offline: the phone forgets you anyway
  token = null;
  await AsyncStorage.removeItem(FLAG);
}

async function authToken(fresh: boolean) {
  if (!fresh && token && Date.now() - tokenAt < TOKEN_MS) return token;
  token = (await authApi<{ token?: string }>("GET", "token").catch(() => ({ token: undefined }))).token || null;
  tokenAt = Date.now();
  return token;
}

// api() as the signed-in user. A token can go stale before it expires, so a 401 gets one fresh try; a second
// 401 means the session is gone, and the phone forgets it.
export async function authed<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const send = async (fresh: boolean) => api<T>(method, path, body, { Authorization: `Bearer ${await authToken(fresh)}` });
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
