// One tab, opened from My tabs or straight from a link (quicktab://g/<slug> or https://getevenup.vercel.app/g/<slug>).
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Keyboard, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from "react-native";
import { FadeInDown } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivitySheet, AdminSheet, BalancesSheet, ExpenseDetail, ExpenseForm, liveExpenses, PaySheet, payee, payMethod,
  shareCsv, ShareSheet, SummarySheet, type Ctx, type Editing,
} from "@/components/sheets";
import Svg, { Path } from "react-native-svg";
import { Anim, Avatar, Tap, Btn, Err, Field, Icon, initials, Label, MenuRow, Rows, T, Tag, Toast, useCountUp, type ToastMsg } from "@/components/ui";
import { Who } from "@/components/who";
import { accountHeaders, claimTab, isSignedIn } from "@/lib/auth";
import { api, ApiError, forgetTab, lifeOf, loadIdentity, plural, rupees, saveIdentity, UPI_HINT, type Expense, type Identity, type Payment, type Tab } from "@/lib/api";
import { useTheme } from "@/lib/theme";

type SheetName = "balances" | "share" | "activity" | "admin" | "form" | "summary" | null;

export default function TabScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const base = `/api/splits/${slug}`;
  const [data, setData] = useState<Tab | null>(null);
  const [identity, setIdentityState] = useState<Identity | null>(null);
  const [loadError, setLoadError] = useState("");
  const [picker, setPicker] = useState(false); // "Who are you?" opened from your name chip
  const [sheet, setSheet] = useState<SheetName>(null);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [paying, setPaying] = useState<Payment | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [toast, setToast] = useState<ToastMsg>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [formKey, setFormKey] = useState(0); // new key per opening: the form starts fresh
  const [typing, setTyping] = useState(false); // keyboard up: the Add expense button steps aside
  const latest = useRef<Tab | null>(null);
  const idRef = useRef<Identity>({});

  const setIdentity = useCallback((next: Identity) => {
    idRef.current = next;
    setIdentityState(next);
    saveIdentity(slug, next);
    // Signed in, who you are here goes on your account too, so the tab is on your Home everywhere.
    if (next.me != null && !latest.current?.group) isSignedIn().then((yes) => yes && claimTab(slug, next).catch(() => {}));
  }, [slug]);

  const load = useCallback(async () => {
    try {
      const d = await api<Tab>("GET", base, undefined, await accountHeaders());
      latest.current = d;
      setData(d);
      setLoadError("");
      return d;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setLoadError("Tabs are deleted a day after they close, or the link is wrong.");
      else if (!latest.current) setLoadError((err as Error).message);
    }
  }, [base]);

  // Opening a link saves the tab on this phone once it loads, so it's in My tabs even before you pick a name.
  // A link that doesn't exist is never saved (and dropped if it was).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open; state is set after the request
    Promise.all([loadIdentity(slug), load()]).then(([i, d]) => {
      if (d?.group) i = { me: d.me ?? undefined }; // your account says who you are; nothing kept on this phone
      idRef.current = i;
      setIdentityState(i);
      if (d?.group) return;
      if (!d) return forgetTab(slug);
      saveIdentity(slug, i);
      // Opening a tab signed in ties it to your account: tabs you made, opened from a link, or had from before.
      if (i.me != null) isSignedIn().then((yes) => yes && claimTab(slug, i).catch(() => {}));
    });

  }, [slug, load]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setTyping(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Live: reload every 15s while this screen is open and the app is in front, like the website.
  useFocusEffect(useCallback(() => {
    const t = setInterval(() => { if (AppState.currentState === "active") load(); }, 15000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && load());
    return () => { clearInterval(t); sub.remove(); };
  }, [load]));

  if (loadError && !data) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        {/* Padding lives on an inner view: SafeAreaView sets its own and overrides className padding. */}
        <Anim entering={FadeInDown.duration(450)} className="gap-4 px-5 pt-16">
          <Tag>not found</Tag>
          <T className="text-[44px] font-bold leading-[48px]">Tab not found</T>
          <T className="leading-6 text-muted">{loadError}</T>
          <Btn variant="ink" title="Back to my tabs" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        </Anim>
      </SafeAreaView>
    );
  }
  if (!data || !identity) {
    return <SafeAreaView className="flex-1 bg-bg"><View className="px-5 pt-16"><Tag live>loading</Tag></View></SafeAreaView>;
  }

  const member = (id: number) => data.members.find((m) => m.id === id);
  const nameOf = (id: number) => member(id)?.name ?? "?";
  const label = (id: number) => (id === identity.me ? "You" : nameOf(id));
  // In a protected tab you're only in once your password gave this phone a session.
  const known = !!member(identity.me!) && (!data.protected || data.ended || !!identity.token);
  const isAdmin = identity.me === data.admin_id && (!!identity.adminToken || data.open_admin);

  if (!known || picker) {
    return <Who slug={slug} data={data} identity={identity} known={known} setIdentity={setIdentity} reload={load} onClose={() => setPicker(false)} />;
  }

  // Every change carries this phone's sessions: the member one (protected tabs) and the admin one.
  const call = async (method: string, sub: string, body?: unknown) => {
    const id = idRef.current;
    const headers: Record<string, string> = await accountHeaders();
    if (id.token) headers["X-Member-Token"] = id.token;
    if (id.adminToken) headers["X-Admin-Token"] = id.adminToken;
    try {
      return await api(method, base + sub, body, headers);
    } catch (err) {
      if ((err as ApiError).status === 401) setIdentity({}); // session no longer valid: back to "Who are you?"
      throw err;
    }
  };
  const adminApi = async (method: string, sub: string, body?: unknown) => {
    try {
      return await call(method, sub, body);
    } catch (err) {
      if ((err as ApiError).status === 403) {
        setIdentity({ me: idRef.current.me, adminToken: null, token: idRef.current.token });
        throw new Error("Admin session ended. Tap your name at the top and enter the password again.");
      }
      throw err;
    }
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      setToast({ text: (err as Error).message, error: true });
    }
    await load();
  };
  const c: Ctx = {
    slug, data, identity, isAdmin, member, nameOf, label, call, adminApi, load, act,
    latest: () => latest.current!, toast: setToast,
  };

  const me = member(identity.me!)!;
  const live = liveExpenses(data);
  const shown = data.expenses.filter((e) => !e.deleted);
  const dayOf = (t: number) => {
    const d = new Date(t * 1000), now = new Date();
    const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
    return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  };
  const when = (t: number) => new Date(t * 1000).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const { hours } = lifeOf(data);
  const startEdit = (e: Expense) => {
    setEditing({ id: e.id, version: e.version, paidBy: e.paid_by, description: e.description, expense: e });
    setFormKey((k) => k + 1);
    setSheet("form");
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between px-5 py-2">
        <Tap accessibilityRole="button" accessibilityLabel="Back to my tabs" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          className="h-11 w-11 items-center justify-center rounded-full border border-line-2 bg-surface-2">
          <Icon.Back color={colors.text} size={18} />
        </Tap>
        <View className="flex-1 flex-row items-center justify-end gap-2 pl-2">
          <Tap accessibilityRole="button" accessibilityLabel="Share" onPress={() => setSheet("share")}
            className="h-11 w-11 items-center justify-center rounded-full border border-line-2 bg-surface-2">
            <Icon.Share color={colors.text} size={18} />
          </Tap>
          {/* The admin's controls, right where the admin's name is; in a group, everyone's (adding people). */}
          {(isAdmin || data.group) && !data.ended && (
            <Tap accessibilityRole="button" accessibilityLabel={data.group ? "Group" : "Admin"} onPress={() => setSheet("admin")}
              className="h-11 w-11 items-center justify-center rounded-full border border-line-2 bg-surface-2">
              <Icon.Shield color={colors.accent} size={18} />
            </Tap>
          )}
          {/* Your name: the avatar sits in the pill's round end, 4px in all round, like the site's .you-chip. */}
          <Tap accessibilityRole="button" accessibilityLabel={`You're ${me.name}. Switch person`} onPress={() => !data.group && setPicker(true)}
            className="h-11 shrink flex-row items-center gap-2.5 rounded-full border border-line-2 bg-surface-2 p-1 pr-3.5">
            <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(227,199,155,0.14)" }}>
              <T className="text-[13px] font-medium text-accent">{initials(me.name)}</T>
            </View>
            <View className="shrink">
              <T className="text-sm font-medium leading-4" numberOfLines={1}>{me.name}</T>
              {isAdmin && <T className="text-[11px] leading-3 text-muted">Admin</T>}
            </View>
            <Icon.Down color={colors.muted} size={14} />
          </Tap>
        </View>
      </View>

      {/* A focused field (your UPI ID) scrolls into view above the keyboard: iOS through the scroll insets, Android by shrinking the page. */}
      <KeyboardAvoidingView behavior={Platform.OS === "android" ? "height" : undefined} className="flex-1">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerClassName="gap-5 px-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.muted}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Anim entering={FadeInDown.duration(450)} className="gap-3 pt-3">
          <T className="text-[48px] font-bold leading-[52px]">{data.name}</T>
          <View className="flex-row items-center gap-2">
            <View className={`h-1.5 w-1.5 rounded-full ${data.ended ? "bg-dim" : "bg-owed"}`} />
            <T className="flex-1 text-sm text-muted" numberOfLines={1}>
              {data.group ? `Group · ${(data.members.length === 1 ? "1 person" : `${data.members.length} people`)}` : data.ended ? `Closed · ${(data.members.length === 1 ? "1 person" : `${data.members.length} people`)}` : `Open until ${when(data.expires_at)} · ${hours}h left · ${(data.members.length === 1 ? "1 person" : `${data.members.length} people`)}`}
            </T>
          </View>
        </Anim>

        {data.ended && (
          <View className="gap-3 rounded-[20px] border border-line bg-surface p-5">
            <T className="text-[22px] font-bold">This tab closed {when(data.expires_at)}</T>
            <T className="text-sm leading-5 text-muted">Nothing can be added now. Save the summary before {when(data.deletes_at)}, when it's deleted for good.</T>
            <View className="flex-row gap-2.5">
              <Btn className="flex-1" title="Save image" onPress={() => setSheet("summary")} />
              <Btn variant="ink" className="flex-1" title="Export CSV" onPress={() => shareCsv(data).catch((e) => setToast({ text: `Couldn't export: ${e?.message || e}`, error: true }))} />
            </View>
          </View>
        )}

        <Anim entering={FadeInDown.delay(120).duration(500)}><Bill c={c} onSettle={setPaying} /></Anim>

        <Rows>
          <MenuRow icon={Icon.Chart} title="Balances" sub="Who owes whom" onPress={() => setSheet("balances")} />
          <MenuRow icon={Icon.History} title="Activity" sub={`Every change in this ${data.group ? "group" : "tab"}${data.activity.length ? ` · ${data.activity.length}` : ""}`} onPress={() => setSheet("activity")} />
        </Rows>

        {/* keyed by person: another person's form starts empty */}
        {!data.ended && <UpiBox key={me.id} c={c} />}

        <Anim entering={FadeInDown.delay(200).duration(450)} className="mt-2 gap-3">
          <View className="flex-row items-baseline gap-2.5">
            <T className="text-[34px] font-bold leading-10">Expenses</T>
            {!!shown.length && <T mono className="text-[13px] text-muted">{shown.length}</T>}
          </View>
          {shown.length === 0 ? (
            <View className="items-center gap-2 rounded-[20px] border border-dashed border-line-2 px-6 py-8">
              <View className="mb-1 h-12 w-12 items-center justify-center rounded-2xl bg-surface-2"><Icon.Receipt color={colors.accent} size={22} /></View>
              <T className="text-[22px] font-bold">No expenses yet</T>
              <T className="text-center text-sm leading-5 text-muted">Add what you paid for, and EvenUp splits it between everyone on the tab.</T>
            </View>
          ) : (
            <View>
              {shown.map((e, i) => {
                const day = dayOf(e.created_at);
                const newDay = !i || dayOf(shown[i - 1].created_at) !== day;
                const mine = e.shares[identity.me!] || 0;
                const payment = e.kind === "payment";
                const to = payee(e);
                const ways = Object.keys(e.shares).length;
                const lent = e.amount_paise - mine;
                const [note, tone] = payment
                  ? [e.paid_by === identity.me ? "You paid" : to === identity.me ? "Paid to you" : `Between ${nameOf(e.paid_by)} and ${nameOf(to)}`, to === identity.me ? "text-owed" : "text-muted"]
                  : e.paid_by === identity.me ? [lent ? `You lent ${rupees(lent)}` : "Just you", lent ? "text-owed" : "text-muted"]
                  : [mine ? `You owe ${rupees(mine)}` : "Not in this one", mine ? "text-owe" : "text-muted"];
                return (
                  <View key={e.id}>
                    {newDay && <T className={`px-3 pb-2 text-[13px] text-muted ${i ? "pt-5" : ""}`}>{day}</T>}
                    <Tap onPress={() => setDetail(e)} className="flex-row items-center gap-3 rounded-2xl px-3 py-3.5">
                      {payment
                        ? <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(95,211,155,0.12)" }}><Icon.Check color={colors.owed} size={18} /></View>
                        : <Avatar name={nameOf(e.paid_by)} />}
                      <View className="flex-1 gap-0.5">
                        <T className="text-[15px] font-medium" numberOfLines={1}>{payment ? `${label(e.paid_by)} paid ${label(to)}` : e.description}</T>
                        <T className="text-[13px] text-muted" numberOfLines={1}>
                          {payment ? `Settled up · ${payMethod(e)}` : `${label(e.paid_by)} paid${ways > 1 ? ` · split ${ways} ways` : ""}`}
                        </T>
                      </View>
                      <View className="items-end gap-0.5">
                        <T className="text-[20px] font-bold" style={{ fontVariant: ["tabular-nums"] }}>{rupees(e.amount_paise)}</T>
                        <T className={`text-xs ${tone}`}>{note}</T>
                      </View>
                    </Tap>
                  </View>
                );
              })}
            </View>
          )}
        </Anim>
        <T className="text-center text-xs text-dim">{plural(live.length, "expense")} · updates every few seconds</T>
      </ScrollView>
      </KeyboardAvoidingView>

      {!data.ended && !typing && (
        <Tap accessibilityRole="button" onPress={() => { setEditing(null); setFormKey((k) => k + 1); setSheet("form"); }}
          className="absolute right-5 h-14 flex-row items-center gap-2.5 rounded-full bg-ink px-6"
          style={{ bottom: insets.bottom + 16, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 }}>
          <Icon.Plus color={colors["ink-text"]} size={18} />
          <T className="text-[15px] font-medium text-ink-text">Add expense</T>
        </Tap>
      )}

      <ExpenseForm key={formKey} c={c} open={sheet === "form"} editing={editing} onClose={() => setSheet(null)} />
      <ExpenseDetail c={c} e={detail} onClose={() => setDetail(null)} onEdit={startEdit} />
      <PaySheet c={c} p={paying} onClose={() => setPaying(null)} />
      <BalancesSheet c={c} open={sheet === "balances"} onClose={() => setSheet(null)} />
      <ActivitySheet c={c} open={sheet === "activity"} onClose={() => setSheet(null)} />
      <AdminSheet c={c} open={sheet === "admin"} onClose={() => setSheet(null)} />
      <ShareSheet c={c} open={sheet === "share"} onClose={() => setSheet(null)} onImage={() => setTimeout(() => setSheet("summary"), 350)} />
      <SummarySheet data={data} open={sheet === "summary"} onClose={() => setSheet(null)} />
      <Toast msg={toast} onDone={() => setToast(null)} />
    </SafeAreaView>
  );
}

// Your share on cream paper, like the website's bill: your balance counting up from 0 for each
// person, the payments that involve you, a barcode and a torn foot.
const BARS = [3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 1, 2, 3, 1, 1, 2, 1, 3, 2, 1, 2, 1];
function Bill({ c, onSettle }: { c: Ctx; onSettle: (p: Payment) => void }) {
  const { colors } = useTheme();
  const { data, identity } = c;
  const me = c.member(identity.me!)!;
  const b = data.balances[me.id] || 0;
  const live = liveExpenses(data);
  const total = live.filter((e) => e.kind !== "payment").reduce((a, e) => a + e.amount_paise, 0);
  const shown = useCountUp(Math.abs(b), me.id);
  const mine = data.settlement.filter((p) => p.from === me.id || p.to === me.id);
  const [whole, paise] = rupees(shown).split(".");
  return (
    <View>
      <View className="rounded-t bg-paper px-6 pt-6">
        <View className="flex-row items-center gap-2">
          <View className={`h-1.5 w-1.5 rounded-full ${b > 0 ? "bg-pos-p" : b < 0 ? "bg-neg-p" : "bg-paper-2"}`} />
          <T className="text-sm text-paper-2">{b > 0 ? "You get back" : b < 0 ? "You owe" : "You're all settled"}</T>
        </View>
        <T className="mt-2 text-[56px] font-bold leading-[60px] text-paper-ink">{whole}<T className="text-[28px] font-bold text-paper-2">.{paise ?? "00"}</T></T>
        <T className="mt-1 text-[13px] text-paper-2">{rupees(total)} spent · {plural(live.filter((e) => e.kind !== "payment").length, "expense")}</T>
        <View className="mt-4">
          {mine.map((p, i) => {
            const other = c.member(p.from === me.id ? p.to : p.from);
            const paying = p.from === me.id;
            return (
              <View key={i} className="flex-row items-center gap-3 border-t border-dashed border-rule py-3.5">
                <Avatar name={other?.name ?? "?"} size={36} paper />
                <View className="flex-1">
                  <T className="text-[15px] font-medium text-paper-ink" numberOfLines={1}>{paying ? `To ${c.label(p.to)}` : `From ${c.label(p.from)}`}</T>
                  <T className="text-xs text-paper-2" numberOfLines={1}>
                    {paying ? (other?.upi_id ? "Pay by UPI or cash" : "No UPI ID yet, cash only") : me.upi_id ? "They can pay you by UPI" : "Add your UPI ID to get paid"}
                  </T>
                </View>
                <T className="text-[15px] font-medium text-paper-ink" style={{ fontVariant: ["tabular-nums"] }}>{rupees(p.amount_paise)}</T>
                {paying && !data.ended && (
                  <Tap accessibilityRole="button" onPress={() => onSettle(p)} className="h-9 justify-center rounded-full bg-paper-ink px-4">
                    <T className="text-sm font-medium text-paper">Pay</T>
                  </Tap>
                )}
              </View>
            );
          })}
          {!mine.length && (
            <View className="flex-row items-center gap-2.5 border-t border-dashed border-rule py-3.5">
              <Icon.Check color={colors["pos-p"]} size={16} />
              <T className="flex-1 text-sm text-paper-2">{live.length ? "Nothing to pay or collect" : "Nothing spent yet. Share the link so others can join"}</T>
            </View>
          )}
        </View>
        <View className="mb-1 mt-3 h-6 flex-row justify-between opacity-80">
          {BARS.map((w, i) => <View key={i} className="h-6 bg-paper-ink" style={{ width: w }} />)}
        </View>
      </View>
      {/* torn foot */}
      <Svg width="100%" height={6} viewBox="0 0 360 6" preserveAspectRatio="none" style={{ marginTop: -1 }}>
        <Path d={`M0 0H360${Array.from({ length: 36 }, (_, i) => `L${360 - i * 10 - 5} 6L${360 - i * 10 - 10} 0`).join("")}Z`} fill={colors.paper} />
      </Svg>
    </View>
  );
}

// Saved: one line with Edit. Not saved yet, or editing: the form.
function UpiBox({ c }: { c: Ctx }) {
  const me = c.member(c.identity.me!)!;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (me.upi_id && !editing) {
    return (
      <View className="h-14 flex-row items-center gap-2.5 rounded-full border border-line bg-surface pl-5 pr-1.5">
        <T className="text-[13px] text-muted">Your UPI ID</T>
        <T mono className="flex-1 text-[13px]" numberOfLines={1}>{me.upi_id}</T>
        <Btn small title="Edit" onPress={() => { setValue(me.upi_id!); setEditing(true); }} className="h-11" />
      </View>
    );
  }
  const save = async () => {
    setError("");
    setBusy(true);
    try {
      await c.call("PUT", `/members/${me.id}/upi`, { upi_id: value.trim() });
      setEditing(false);
      await c.load();
      c.toast({ text: "UPI ID saved" });
    } catch (err) {
      setError((err as ApiError).status === 422 ? UPI_HINT : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-3 rounded-[20px] border border-line bg-surface p-5">
      <Label>{editing ? "Change your UPI ID" : "Add your UPI ID so people can pay you"}</Label>
      {/* First time: input and Save on one row. Editing: the input gets the full width, Cancel and Save share a row. */}
      <View className={editing ? "gap-2" : "flex-row gap-2"}>
        <Field className={`h-12 ${editing ? "" : "min-w-0 flex-1"}`} value={value} onChangeText={setValue} placeholder="name@bank" autoCapitalize="none" autoCorrect={false} maxLength={100} onSubmitEditing={save} />
        <View className="flex-row gap-2">
          {editing && <Btn className="h-12 flex-1" title="Cancel" onPress={() => setEditing(false)} />}
          <Btn variant="ink" className={`h-12 ${editing ? "flex-1" : ""}`} title="Save" busy={busy} disabled={!value.trim()} onPress={save} />
        </View>
      </View>
      <Err>{error}</Err>
    </View>
  );
}
