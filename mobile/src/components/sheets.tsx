// Everything that slides up inside a tab: the website's sheets, one for one.
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Linking, Platform, Share, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { Tap, Btn, Err, Field, Icon, Label, MenuRow, Rows, Sheet, T, useConfirm, type ToastMsg } from "@/components/ui";
import {
  BASE, forgetTab, plainAmount, plural, rupees, tabUrl, toPaise, UPI_HINT,
  type Expense, type Identity, type Member, type Payment, type Tab,
} from "@/lib/api";
import { MONO } from "@/lib/theme";

// What every sheet needs from the tab screen.
export type Ctx = {
  slug: string; data: Tab; identity: Identity; isAdmin: boolean;
  member: (id: number) => Member | undefined; nameOf: (id: number) => string; label: (id: number) => string;
  call: <R = any>(method: string, sub: string, body?: unknown) => Promise<R>; // sub: "/expenses" etc. under the tab
  adminApi: <R = any>(method: string, sub: string, body?: unknown) => Promise<R>;
  load: () => Promise<Tab | undefined>; latest: () => Tab; act: (fn: () => Promise<unknown>) => Promise<void>;
  toast: (t: ToastMsg) => void;
};

export const liveExpenses = (t: Tab) => t.expenses.filter((e) => !e.deleted && e.kind === "expense");
export const payMethod = (e: Expense) => e.description.split(" · ").pop(); // payments are stored as "A paid B · Cash"
export const payee = (e: Expense) => Number(Object.keys(e.shares)[0]);
const when = (t: number) => new Date(t * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Undo the latest change to one expense, looked up after the reload that recorded it.
const undoFor = (c: Ctx, expenseId: number) => () => c.act(() => {
  const a = c.latest().activity.find((x) => x.expense_id === expenseId);
  return a ? c.call("POST", `/activity/${a.id}/undo`) : Promise.resolve();
});

// ---------- add / edit expense ----------

export type Editing = { id: number; version: number; paidBy: number; description: string; expense: Expense } | null;

export function ExpenseForm({ c, open, editing, onClose }: { c: Ctx; open: boolean; editing: Editing; onClose: () => void }) {
  const { data, identity } = c;
  // Mounted fresh each time it opens (keyed by the screen): everyone ticked for a new expense, the saved split for an edit.
  const e = editing?.expense;
  const amounts = e ? Object.values(e.shares) : [];
  const [amount, setAmount] = useState(e ? plainAmount(e.amount_paise) : "");
  const [desc, setDesc] = useState(e?.description ?? "");
  const [split, setSplit] = useState<"equal" | "exact">(e && Math.max(...amounts) - Math.min(...amounts) > 1 ? "exact" : "equal");
  const [picked, setPicked] = useState<number[]>(e ? Object.keys(e.shares).map(Number) : data.members.map((m) => m.id));
  const [exact, setExact] = useState<Record<number, string>>(e ? Object.fromEntries(Object.entries(e.shares).map(([id, s]) => [id, plainAmount(s)])) : {});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError("");
    const paise = toPaise(amount);
    if (!paise) return setError("Enter a valid amount, like 1200 or 99.50.");
    const body: any = {
      // Left empty: "Expense #N" (counting deleted ones, so numbers don't repeat), or the old name when editing.
      description: desc.trim() || (editing ? editing.description : `Expense #${data.expenses.filter((x) => x.kind === "expense").length + 1}`),
      amount_paise: paise,
      paid_by: editing ? editing.paidBy : identity.me, // new expenses are paid by you; editing keeps whoever paid
      split,
    };
    if (split === "equal") {
      body.participants = picked;
      if (!picked.length) return setError("Pick at least one person.");
    } else {
      body.shares = {};
      for (const [id, v] of Object.entries(exact)) {
        if (!v.trim()) continue;
        const p = toPaise(v);
        if (p === null) return setError("Exact amounts must be numbers.");
        body.shares[id] = p;
      }
      const sum = Object.values<number>(body.shares).reduce((a, b) => a + b, 0);
      if (sum !== paise) return setError(`Exact amounts add up to ${rupees(sum)}, not ${rupees(paise)}.`);
    }
    setBusy(true);
    try {
      if (editing) await c.call("PUT", `/expenses/${editing.id}`, { ...body, version: editing.version });
      else await c.call("POST", "/expenses", body);
      onClose();
      await c.load();
      c.toast({ text: editing ? "Changes saved" : `Added ${body.description}` });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const paise = toPaise(amount);
  return (
    <Sheet open={open} onClose={onClose} kicker={editing ? "Edit" : "New expense"} title={editing ? "Edit expense" : "Add expense"}
      footer={<Btn variant="accent" className="flex-1" busy={busy} onPress={save}
        title={editing ? "Save changes" : paise ? `Add ${rupees(paise).replace(/\.00$/, "")} expense` : "Add expense"} />}>
      <T className="text-sm text-muted">Paid by {editing ? (editing.paidBy === identity.me ? "you" : c.nameOf(editing.paidBy)) : "you"}</T>
      <View className="gap-1.5">
        <Label>Amount (₹)</Label>
        {/* Same size for both, centred: baseline alignment is unreliable on a TextInput. Android's font padding would push the digits off centre. */}
        <View className="flex-row items-center gap-2 border-b-2 border-accent">
          <T className="text-[40px] font-bold text-muted" style={{ includeFontPadding: false }}>₹</T>
          <Field value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" autoFocus={!editing}
            className="h-14 min-w-0 flex-1 border-0 bg-transparent px-0 text-[40px] font-bold"
            style={{ borderWidth: 0, paddingVertical: 0, includeFontPadding: false, textAlignVertical: "center" }} />
        </View>
      </View>
      <View className="gap-2">
        <Label>What for? <T className="text-[11px] normal-case text-dim">optional</T></Label>
        <Field value={desc} onChangeText={setDesc} maxLength={100} placeholder="Dinner, cab, tickets…" />
      </View>
      <View className="gap-2">
        <Label>Split</Label>
        <View className="flex-row gap-px border border-line-2 bg-line-2">
          {(["equal", "exact"] as const).map((s) => (
            <Tap key={s} accessibilityRole="radio" accessibilityState={{ checked: split === s }} onPress={() => setSplit(s)}
              className={`h-11 flex-1 items-center justify-center ${split === s ? "bg-ink" : "bg-surface"}`}>
              <T className={`text-sm font-medium ${split === s ? "text-ink-text" : ""}`}>{s === "equal" ? "Equally" : "Exact amounts"}</T>
            </Tap>
          ))}
        </View>
        {split === "equal" ? (
          <View className="flex-row flex-wrap gap-2">
            {data.members.map((m) => {
              const on = picked.includes(m.id);
              return (
                <Tap key={m.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                  onPress={() => setPicked(on ? picked.filter((x) => x !== m.id) : [...picked, m.id])}
                  className={`h-11 max-w-full justify-center border px-4 ${on ? "border-ink bg-ink" : "border-line-2 bg-surface"}`}>
                  <T className={`text-sm ${on ? "font-semibold text-ink-text" : "text-muted"}`} numberOfLines={1}>{m.name}</T>
                </Tap>
              );
            })}
          </View>
        ) : (
          <Rows>
            {data.members.map((m) => (
              <View key={m.id} className="flex-row items-center gap-3 bg-surface pl-4">
                <T className="flex-1 text-[15px]" numberOfLines={1}>{m.name}</T>
                <Field value={exact[m.id] ?? ""} onChangeText={(v) => setExact({ ...exact, [m.id]: v })} keyboardType="decimal-pad" placeholder="0"
                  className="w-32 border-0 border-l border-line text-right" style={{ fontFamily: MONO, borderLeftWidth: 1 }} />
              </View>
            ))}
          </Rows>
        )}
      </View>
      <Err>{error}</Err>
    </Sheet>
  );
}

// ---------- one expense ----------

export function ExpenseDetail({ c, e: next, onClose, onEdit }: { c: Ctx; e: Expense | null; onClose: () => void; onEdit: (e: Expense) => void }) {
  // Keeps showing the last expense while the sheet slides away.
  const [last, setLast] = useState(next);
  if (next && next !== last) setLast(next);
  const e = next ?? last;
  if (!e) return null;
  const payment = e.kind === "payment";
  const del = async () => {
    onClose();
    await c.act(() => c.call("DELETE", `/expenses/${e.id}`));
    c.toast({ text: `Deleted ${payment ? "payment" : e.description}`, action: "Undo", onAction: undoFor(c, e.id) });
  };
  return (
    <Sheet open={!!next} onClose={onClose} kicker={payment ? "Payment" : "Expense"} title={payment ? "Settle-up" : e.description}
      footer={c.data.ended ? undefined : <>
        <Btn variant="danger" className="flex-1" title="Delete" onPress={del} />
        {!payment && <Btn variant="ink" className="flex-1" title="Edit" onPress={() => { onClose(); onEdit(e); }} />}
      </>}>
      <T className="text-4xl font-bold tracking-tight">{rupees(e.amount_paise)}</T>
      {payment ? (
        <T className="text-sm text-muted">{c.label(e.paid_by)} paid {c.label(payee(e))} · {payMethod(e)} · {when(e.created_at)}</T>
      ) : (
        <>
          <T className="text-sm text-muted">Paid by {c.label(e.paid_by)} · {when(e.created_at)}</T>
          <Label>Split between</Label>
          <Rows>
            {Object.entries(e.shares).map(([id, s]) => (
              <View key={id} className="flex-row justify-between bg-surface px-4 py-3">
                <T>{c.label(Number(id))}</T>
                <T mono>{rupees(s)}</T>
              </View>
            ))}
          </Rows>
        </>
      )}
    </Sheet>
  );
}

// ---------- settle up one payment: cash or UPI, then record it ----------

// iOS has no "pick a UPI app" chooser like Android, so it gets our own list. Same apps and schemes as the website.
const IOS_APPS: [string, string][] = [["PhonePe", "phonepe://pay"], ["Google Pay", "gpay://upi/pay"], ["Paytm", "paytmmp://pay"], ["BHIM", "bhim://pay"]];

// Same format as upi_link() in main.py: %20 not +, and @ left as is, for picky UPI apps.
function upiLink(to: Member, paise: number, tabName: string, scheme = "upi://pay") {
  const params = { pa: to.upi_id!, pn: to.name, am: plainAmount(paise), cu: "INR", tn: tabName.slice(0, 50) };
  return `${scheme}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, "@")}`).join("&")}`;
}

export function PaySheet({ c, p: next, onClose }: { c: Ctx; p: Payment | null; onClose: () => void }) {
  // Two pop-ups: "How are you paying?", then Cash or UPI on its own sheet. Picking one slides the first down and the
  // next up (one after the other: iOS can't present two sheets at once); Back does the reverse.
  const [step, setStep] = useState<"Cash" | "UPI">("Cash");
  const [shown, setShown] = useState<"choose" | "method" | null>("choose");
  const [error, setError] = useState("");
  const [last, setLast] = useState(next);
  if (next && next !== last) {
    setLast(next);
    setShown("choose");
    setError("");
  }
  const p = next ?? last;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!p) return null;
  const to = c.member(p.to)!;

  const swap = (to: "choose" | "method", method?: "Cash" | "UPI") => {
    setShown(null);
    setError("");
    setTimeout(() => {
      if (method) setStep(method);
      setShown(to);
    }, 260);
  };
  const done = async () => {
    setBusy(true);
    try {
      const { id } = await c.call("POST", "/expenses", {
        kind: "payment", paid_by: p.from, amount_paise: p.amount_paise, split: "exact", shares: { [p.to]: p.amount_paise },
        // Real names so the activity log reads right; the list swaps in "You".
        description: `${c.nameOf(p.from)} paid ${c.nameOf(p.to)} · ${step}`,
      });
      onClose();
      await c.load();
      c.toast({ text: `Paid ${c.nameOf(p.to)} ${rupees(p.amount_paise)}`, action: "Undo", onAction: undoFor(c, id) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openApp = (url: string) => Linking.openURL(url).catch(() => setError("That app isn't on this phone. Try another, or pay by hand to the UPI ID."));
  const title = `Pay ${rupees(p.amount_paise)} to ${to.name}`;

  return (
    <>
      <Sheet open={!!next && shown === "choose"} onClose={onClose} kicker="Settle up" title={title}>
        <T className="text-sm text-muted">How are you paying?</T>
        <Rows>
          <MenuRow icon={Icon.Cash} title="Cash" sub="Paid in person, mark it here" onPress={() => swap("method", "Cash")} />
          <MenuRow icon={Icon.Phone} title="UPI" sub={to.upi_id ? `Opens your UPI app with ${rupees(p.amount_paise)} filled in` : "No UPI ID yet"}
            disabled={!to.upi_id} onPress={() => swap("method", "UPI")} />
        </Rows>
        {!to.upi_id && <T className="text-sm text-muted">{to.name} hasn't added a UPI ID yet, so it's cash for now.</T>}
      </Sheet>

      <Sheet open={!!next && shown === "method"} onClose={onClose} kicker={step} title={title}
        footer={<>
          <Btn className="flex-1" title="Back" onPress={() => swap("choose")} />
          <Btn variant={step === "Cash" ? "ink" : "plain"} className="flex-1" busy={busy} onPress={done} title={step === "Cash" ? "Mark as paid" : "I've paid"} />
        </>}>
        {step === "Cash" ? <>
          <T className="text-lg font-semibold">Did you pay {to.name} {rupees(p.amount_paise)} in cash?</T>
          <T className="text-sm text-muted">Marking it paid updates balances for everyone.</T>
        </> : <>
          <UpiQr path={`/api/splits/${c.slug}/qr?to=${to.id}&amount=${p.amount_paise}`} />
          <T className="text-center text-sm leading-5 text-muted">Scan from any UPI app, or pay on this phone. The amount is filled in. Then come back and tap I've paid.</T>
          {Platform.OS === "ios" ? (
            <Rows>
              {IOS_APPS.map(([name, scheme]) => (
                <MenuRow key={name} icon={Icon.Phone} title={name} sub={`Pay ${rupees(p.amount_paise)} to ${to.upi_id}`}
                  onPress={() => openApp(upiLink(to, p.amount_paise, c.data.name, scheme))} />
              ))}
            </Rows>
          ) : (
            <Btn variant="accent" title="Pay now" onPress={() => openApp(upiLink(to, p.amount_paise, c.data.name))} />
          )}
          <View className="gap-1.5">
            <T className="text-sm text-muted">Or pay by hand to this UPI ID</T>
            <View className="flex-row items-center gap-2 border border-line-2 bg-surface py-1.5 pl-3.5 pr-1.5">
              <T mono className="flex-1 text-sm" numberOfLines={1}>{to.upi_id}</T>
              <Btn small title={copied ? "Copied" : "Copy"} onPress={async () => { await Clipboard.setStringAsync(to.upi_id!); setCopied(true); setTimeout(() => setCopied(false), 1500); }} />
            </View>
          </View>
        </>}
        <Err>{error}</Err>
      </Sheet>
    </>
  );
}

// The tab's UPI QR from the API (the same one the website shows), dark squares on a white card so it scans in dark mode.
function UpiQr({ path }: { path: string }) {
  const [xml, setXml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(BASE + path)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => live && setXml(t))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [path]);
  if (failed) return null;
  return (
    <View className="items-center">
      <View className="h-[232px] w-[232px] items-center justify-center bg-white p-3">
        {xml ? <SvgXml xml={xml} width={208} height={208} /> : <ActivityIndicator color="#0d0d0c" />}
      </View>
    </View>
  );
}

// ---------- balances ----------

export function BalancesSheet({ c, open, onClose }: { c: Ctx; open: boolean; onClose: () => void }) {
  const { data, identity } = c;
  return (
    <Sheet open={open} onClose={onClose} kicker={`${c.data.members.length} people`} title="Balances">
      <T className="text-sm text-muted">Debts are simplified, so each line is one real payment.</T>
      <Rows>
        {data.members.map((m) => {
          const b = data.balances[m.id] || 0;
          const you = m.id === identity.me;
          const pays = data.settlement.filter((p) => p.from === m.id || p.to === m.id);
          return (
            <View key={m.id} className="gap-1.5 bg-surface px-4 py-3">
              <View className="flex-row justify-between gap-3">
                <T className="flex-1 font-medium">{c.label(m.id)}</T>
                <T mono className={b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-muted"}>
                  {b > 0 ? `${you ? "get" : "gets"} back ${rupees(b)}` : b < 0 ? `${you ? "owe" : "owes"} ${rupees(-b)}` : "settled"}
                </T>
              </View>
              {pays.map((p, i) => (
                <View key={i} className="flex-row justify-between border-l border-line-2 pl-3">
                  <T className="text-[13px] text-muted">{c.label(p.from)} → {c.label(p.to)}</T>
                  <T mono className="text-[13px] text-muted">{rupees(p.amount_paise)}</T>
                </View>
              ))}
            </View>
          );
        })}
      </Rows>
    </Sheet>
  );
}

// ---------- activity ----------

const ACTIONS: Record<string, string> = {
  created: "Tab opened", added: "Added", edited: "Edited", deleted: "Deleted", restored: "Restored",
  member_added: "Member added:", member_removed: "Member removed:", upi_set: "UPI ID updated for",
};

export function ActivitySheet({ c, open, onClose }: { c: Ctx; open: boolean; onClose: () => void }) {
  const { data } = c;
  const kindOf = (id: number | null) => data.expenses.find((e) => e.id === id)?.kind;
  // New expenses are already in the expense list, so the log keeps payments and every other change.
  const shown = data.activity.filter((a) => !(a.action === "added" && kindOf(a.expense_id) === "expense"));
  return (
    <Sheet open={open} onClose={onClose} kicker="History" title="Activity">
      {shown.length ? <Rows>
        {shown.map((a) => {
          const d = a.details;
          const what = d.description ? `${d.description} (${rupees(d.amount_paise)})` : d.name || "";
          // Only the latest change to each expense can be undone; the server checks this too.
          const canUndo = !data.ended && !!a.expense_id && data.activity.find((x) => x.expense_id === a.expense_id) === a;
          return (
            <View key={a.id} className="flex-row items-center gap-3 bg-surface px-4 py-3">
              <View className="flex-1 gap-0.5">
                <T className="text-[15px]">{a.action === "added" ? what : `${ACTIONS[a.action] || a.action} ${what}`}</T>
                <T className="text-xs text-muted">{when(a.created_at)}</T>
              </View>
              {canUndo && <Btn small title="Undo" onPress={() => c.act(() => c.call("POST", `/activity/${a.id}/undo`))} />}
            </View>
          );
        })}
      </Rows> : <T className="text-muted">Nothing yet.</T>}
    </Sheet>
  );
}

// ---------- admin ----------

export function AdminSheet({ c, open, onClose }: { c: Ctx; open: boolean; onClose: () => void }) {
  const { data } = c;
  const [name, setName] = useState("");
  const [upi, setUpi] = useState("");
  const [editUpi, setEditUpi] = useState<{ id: number; value: string } | null>(null);
  const [error, setError] = useState("");
  const full = data.members.length >= data.capacity;

  const run = async (fn: () => Promise<unknown>, upiError = false) => {
    setError("");
    try {
      await fn();
      await c.load();
      return true;
    } catch (err) {
      setError(upiError && (err as any).status === 422 ? UPI_HINT : (err as Error).message);
      return false;
    }
  };
  const [confirmEl, ask] = useConfirm();
  const remove = async (m: Member) => {
    if (await ask(`Remove ${m.name}?`, "They can join again from the link if they need to.", "Remove")) run(() => c.adminApi("DELETE", `/members/${m.id}`));
  };
  const deleteTab = async () => {
    if (!(await ask("Delete this tab?", "It's deleted for everyone, with all its expenses and payments. This can't be undone.", "Delete tab"))) return;
    try {
      await c.adminApi("DELETE", "");
      await forgetTab(c.slug);
      onClose();
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} kicker="Admin only" title="Admin" overlay={confirmEl}>
      <Rows>
        {data.members.map((m) => (
          <View key={m.id} className="gap-2 bg-surface px-4 py-3">
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
                <T className="font-medium">{m.name}</T>
                <T mono className="text-xs text-muted">{m.upi_id || "no UPI ID"}</T>
              </View>
              <Btn small title="UPI" onPress={() => setEditUpi({ id: m.id, value: m.upi_id || "" })} />
              {m.id !== data.admin_id && <Btn small title="Remove" onPress={() => remove(m)} />}
            </View>
            {editUpi?.id === m.id && (
              <View className="flex-row gap-2">
                <Field className="h-10 flex-1" value={editUpi.value} onChangeText={(v) => setEditUpi({ id: m.id, value: v })}
                  placeholder="name@bank (empty to clear)" autoCapitalize="none" autoCorrect={false} autoFocus />
                <Btn small variant="ink" title="Save" onPress={async () => {
                  if (await run(() => c.adminApi("PUT", `/members/${m.id}/upi`, { upi_id: editUpi.value.trim() || null }), true)) setEditUpi(null);
                }} />
              </View>
            )}
          </View>
        ))}
      </Rows>
      <Label>Add someone</Label>
      <Field value={name} onChangeText={setName} maxLength={40} placeholder="Name" autoCapitalize="words" />
      <Field value={upi} onChangeText={setUpi} maxLength={100} placeholder="UPI ID (optional)" autoCapitalize="none" autoCorrect={false} />
      <Btn variant="ink" disabled={full || !name.trim()} title={full ? "Full: remove someone first" : "Add person"} onPress={async () => {
        if (await run(() => c.adminApi("POST", "/members", { name: name.trim(), upi_id: upi.trim() || null }), true)) { setName(""); setUpi(""); }
      }} />
      <Err>{error}</Err>
      <View className="mt-2 border-t border-line pt-4">
        <Btn variant="danger" title="Delete this tab now" onPress={deleteTab} />
      </View>
    </Sheet>
  );
}

// ---------- share: link, summary image, CSV ----------

export function ShareSheet({ c, open, onClose, onImage }: { c: Ctx; open: boolean; onClose: () => void; onImage: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = tabUrl(c.slug);
  return (
    <Sheet open={open} onClose={onClose} kicker="Send or save" title="Share">
      <Rows>
        <MenuRow icon={copied ? Icon.Check : Icon.Link} title={copied ? "Copied" : "Copy link"} sub="Anyone with it can join and add expenses"
          onPress={async () => { await Clipboard.setStringAsync(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }} />
        <MenuRow icon={Icon.Share} title="Send link" sub="WhatsApp, Telegram, anything on your phone"
          onPress={() => Share.share({ message: `Add what you paid on QuickTab, we'll settle up with UPI. ${link}`, url: link }).catch(() => {})} />
        <MenuRow icon={Icon.Image} title="Summary image" sub="Balances and payments as one picture" onPress={() => { onClose(); onImage(); }} />
        <MenuRow icon={Icon.File} title="Export CSV" sub="Every expense and share, for a spreadsheet"
          onPress={() => shareCsv(c.data).catch((e) => c.toast({ text: `Couldn't export: ${e?.message || e}`, error: true }))} />
      </Rows>
    </Sheet>
  );
}


// One row per expense and payment with everyone's share, then the final balances. Same columns as the website's CSV.
export async function shareCsv(data: Tab) {
  const nameOf = (id: number) => data.members.find((m) => m.id === id)?.name ?? "?";
  // Names come from anyone with the link: quote them, and defuse spreadsheet formulas (=, +, -, @).
  const text = (v: unknown) => `"${String(v).replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const amount = (p: number) => (p < 0 ? "-" : "") + plainAmount(Math.abs(p));
  const rows: string[][] = [["Date", "Type", "Description", "Paid by", "Amount (₹)", ...data.members.map((m) => m.name)].map(text)];
  for (const e of data.expenses.filter((x) => !x.deleted).reverse()) {
    rows.push([text(new Date(e.created_at * 1000).toLocaleString("en-IN")), text(e.kind), text(e.description), text(nameOf(e.paid_by)),
      amount(e.amount_paise), ...data.members.map((m) => (e.shares[m.id] ? amount(e.shares[m.id]) : ""))]);
  }
  rows.push([], [text("Balance (+ gets back, - owes)"), "", "", "", "", ...data.members.map((m) => amount(data.balances[m.id] || 0))]);
  const file = new File(Paths.cache, "quicktab.csv");
  if (file.exists) file.delete();
  file.create();
  file.write("﻿" + rows.map((r) => r.join(",")).join("\r\n")); // BOM so Excel reads ₹ as UTF-8
  await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "QuickTab expenses", UTI: "public.comma-separated-values-text" });
}

// The website's summary receipt, drawn as a view and shared as a PNG. Always light, like the website's image.
const R = { bg: "#fafaf9", text: "#0d0d0c", muted: "#6b6963", line: "#d4d2ce", accent: "#2b4bff" };

export function SummarySheet({ data, open, onClose }: { data: Tab; open: boolean; onClose: () => void }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameOf = (id: number) => data.members.find((m) => m.id === id)?.name ?? "?";
  const money = (p: number) => rupees(p).replace(/\.00$/, "");
  const expenses = liveExpenses(data);
  const total = expenses.reduce((a, e) => a + e.amount_paise, 0);
  const payments = data.expenses.filter((e) => !e.deleted && e.kind === "payment").reverse();
  const date = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const share = async () => {
    setBusy(true);
    try {
      const uri = await captureRef(ref, { format: "png", quality: 1 });
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "QuickTab summary" });
    } catch (err) {
      setError(`Couldn't make the image: ${(err as Error)?.message || err}`);
    } finally {
      setBusy(false);
    }
  };
  const t = (size: number, color = R.text, weight: "400" | "600" | "700" = "400") => ({ fontSize: size, color, fontWeight: weight });
  return (
    <Sheet open={open} onClose={onClose} kicker="PNG" title="Summary image" footer={<Btn variant="accent" className="flex-1" busy={busy} title="Share image" onPress={share} />}>
      <View ref={ref} collapsable={false} style={{ backgroundColor: R.bg, padding: 24, borderWidth: 1, borderColor: R.line }}>
        <T style={t(24, R.text, "700")}>{data.name}</T>
        <T style={[t(12, R.muted), { marginTop: 6 }]}>
          {date} · {money(total)} spent · {plural(expenses.length, "expense")} · {plural(data.members.length, "person").replace("persons", "people")}
        </T>
        <View style={{ height: 1, backgroundColor: R.line, marginVertical: 16 }} />
        <T style={[t(11, R.muted, "600"), { letterSpacing: 1 }]}>BALANCES</T>
        {data.members.map((m) => {
          const b = data.balances[m.id] || 0;
          const lines = [
            ...data.settlement.filter((p) => p.from === m.id).map((p) => [`pays ${nameOf(p.to)}`, p.amount_paise] as const),
            ...data.settlement.filter((p) => p.to === m.id).map((p) => [`gets from ${nameOf(p.from)}`, p.amount_paise] as const),
          ];
          return (
            <View key={m.id} style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <T style={t(15, R.text, "600")}>{m.name}</T>
                {b ? <T style={t(15, b > 0 ? R.accent : R.text, "700")}><T style={t(12, R.muted)}>{b > 0 ? "gets back " : "owes "}</T>{money(Math.abs(b))}</T>
                  : <T style={t(13, R.muted)}>settled</T>}
              </View>
              {lines.map(([what, amt], i) => (
                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4, marginLeft: 5, paddingLeft: 12, borderLeftWidth: 1, borderColor: R.line }}>
                  <T style={t(12, R.muted)}>{what}</T><T style={t(12, R.muted)}>{money(amt)}</T>
                </View>
              ))}
            </View>
          );
        })}
        {payments.length > 0 && <>
          <View style={{ height: 1, backgroundColor: R.line, marginVertical: 16 }} />
          <T style={[t(11, R.muted, "600"), { letterSpacing: 1 }]}>PAYMENTS MADE</T>
          {payments.map((p) => (
            <View key={p.id} style={{ marginTop: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <T style={t(14, R.text, "600")}>{nameOf(p.paid_by)} paid {nameOf(payee(p))}</T>
                <T style={t(14, R.text, "600")}>{money(p.amount_paise)}</T>
              </View>
              <T style={t(11, R.muted)}>{payMethod(p)} · {when(p.created_at)}</T>
            </View>
          ))}
        </>}
        <View style={{ height: 1, backgroundColor: R.line, marginVertical: 16 }} />
        <T style={t(11, R.muted)}>Split with QuickTab</T>
      </View>
      <Err>{error}</Err>
    </Sheet>
  );
}
