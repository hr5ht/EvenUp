// The same API the website uses. Money is integer paise everywhere.
import AsyncStorage from "@react-native-async-storage/async-storage";

// Production by default; EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8000 for the local server.
export const BASE = (process.env.EXPO_PUBLIC_API_URL || "https://quicktabapp.vercel.app").replace(/\/$/, "");
export const tabUrl = (slug: string) => `${BASE}/g/${slug}`;

export type Member = { id: number; name: string; upi_id: string | null; has_password: boolean };
export type Expense = {
  id: number; paid_by: number; amount_paise: number; description: string; kind: "expense" | "payment";
  version: number; created_at: number; deleted: boolean; shares: Record<string, number>;
};
export type Activity = { id: number; action: string; expense_id: number | null; details: any; created_at: number };
export type Payment = { from: number; to: number; amount_paise: number };
export type Tab = {
  name: string; expires_at: number; deletes_at: number; ended: boolean; admin_id: number; protected: boolean;
  admin_login: boolean; open_admin: boolean; capacity: number; members: Member[]; expenses: Expense[];
  balances: Record<string, number>; settlement: Payment[]; activity: Activity[];
};

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("No connection. Check your internet and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data.detail;
    if (Array.isArray(msg)) msg = msg.map((d: any) => d.msg).join(", ");
    throw new ApiError(msg || `Request failed (${res.status})`, res.status);
  }
  return data;
}

// ---------- money ----------

export function rupees(paise: number) {
  const sign = paise < 0 ? "-" : "";
  const p = Math.abs(paise);
  return `${sign}₹${Math.floor(p / 100).toLocaleString("en-IN")}.${String(p % 100).padStart(2, "0")}`;
}

// "12.5" -> 1250. null for anything that isn't a plain amount.
export function toPaise(str: string) {
  const s = String(str).trim().replace(/,/g, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) return null;
  const [r, f = ""] = s.split(".");
  return Number(r) * 100 + Number(f.padEnd(2, "0"));
}

export const plainAmount = (paise: number) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const UPI_HINT = "That doesn't look like a UPI ID (name@bank).";

// Hours left of the 48 and the time-left bar's width, from the tab's own clock.
export function lifeOf(t: Tab) {
  const now = Date.now() / 1000;
  return { hours: Math.max(0, Math.round((t.expires_at - now) / 3600)), pct: Math.max(2, Math.min(100, ((t.expires_at - now) / (48 * 3600)) * 100)) };
}

// Every tab is called "Quick tab", so lists tell them apart by who's in them.
export function tabTitle(t: Tab) {
  if (t.name !== "Quick tab") return t.name;
  const names = t.members.map((m) => m.name);
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
}

// A pasted link, or just the code: ".../g/abc?x" -> "abc".
export const slugFrom = (v: string) => v.trim().split("/g/").pop()!.split(/[?#/\s]/)[0];

// ---------- tabs saved on this phone ----------
// Who you are in each tab lives here, so the link never has to be kept: {me, token, adminToken} per slug.

export type Identity = { me?: number; token?: string | null; adminToken?: string | null };
type Saved = Record<string, Identity & { addedAt: number }>;
const KEY = "quicktab:tabs";

async function readAll(): Promise<Saved> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) || "{}");
  } catch {
    return {};
  }
}

export async function savedTabs() {
  const all = await readAll();
  return Object.entries(all).sort((a, b) => b[1].addedAt - a[1].addedAt).map(([slug, v]) => ({ slug, ...v }));
}

export async function loadIdentity(slug: string): Promise<Identity> {
  const { addedAt, ...identity } = (await readAll())[slug] || ({} as Saved[string]);
  return identity;
}

export async function saveIdentity(slug: string, identity: Identity) {
  const all = await readAll();
  all[slug] = { ...identity, addedAt: all[slug]?.addedAt ?? Date.now() };
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}

export async function forgetTab(slug: string) {
  const all = await readAll();
  delete all[slug];
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}
