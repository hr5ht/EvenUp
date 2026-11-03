// One tab, opened from My tabs or straight from a link (quicktab://g/<slug> or https://quicktabapp.vercel.app/g/<slug>).
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, RefreshControl, ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivitySheet, AdminSheet, BalancesSheet, ExpenseDetail, ExpenseForm, liveExpenses, PaySheet, payee, payMethod,
  shareCsv, ShareSheet, SummarySheet, type Ctx, type Editing,
} from "@/components/sheets";
import { Tap, Btn, Err, Field, Icon, Label, T, Tag, Toast, useCountUp, type ToastMsg } from "@/components/ui";
import { Who } from "@/components/who";
import { api, ApiError, lifeOf, loadIdentity, plural, rupees, saveIdentity, UPI_HINT, type Expense, type Identity, type Payment, type Tab } from "@/lib/api";
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
  const latest = useRef<Tab | null>(null);
  const idRef = useRef<Identity>({});

  const setIdentity = useCallback((next: Identity) => {
    idRef.current = next;
    setIdentityState(next);
    saveIdentity(slug, next);
  }, [slug]);

  const load = useCallback(async () => {
    try {
      const d = await api<Tab>("GET", base);
      latest.current = d;
      setData(d);
      setLoadError("");
      return d;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setLoadError("Tabs are deleted a day after they close, or the link is wrong.");
      else if (!latest.current) setLoadError((err as Error).message);
    }
  }, [base]);

  // Opening a link saves the tab on this phone straight away, so it's in My tabs even before you pick a name.
  useEffect(() => {
    loadIdentity(slug).then((i) => {
      idRef.current = i;
      setIdentityState(i);
      saveIdentity(slug, i);
    });
    load(); // eslint-disable-line react-hooks/set-state-in-effect -- fetch on open; state is set after the request

  }, [slug, load]);

  // Live: reload every 15s while this screen is open and the app is in front, like the website.
  useFocusEffect(useCallback(() => {
    const t = setInterval(() => { if (AppState.currentState === "active") load(); }, 15000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && load());
    return () => { clearInterval(t); sub.remove(); };
  }, [load]));

  if (loadError && !data) {
    return (
      <SafeAreaView className="flex-1 gap-4 bg-bg px-5 pt-16">
        <Tag>not found</Tag>
        <T className="text-[30px] font-bold tracking-tight">Tab not found</T>
        <T className="text-muted">{loadError}</T>
        <Btn variant="ink" title="Back to my tabs" onPress={() => router.replace("/")} />
      </SafeAreaView>
    );
  }
  if (!data || !identity) {
    return <SafeAreaView className="flex-1 bg-bg px-5 pt-16"><T className="text-muted">Loading…</T></SafeAreaView>;
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
    const headers: Record<string, string> = {};
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
      Alert.alert("Couldn't do that", (err as Error).message);
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
  const when = (t: number) => new Date(t * 1000).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const { hours, pct: life } = lifeOf(data);
  const startEdit = (e: Expense) => {
    setEditing({ id: e.id, version: e.version, paidBy: e.paid_by, description: e.description, expense: e });
    setSheet("form");
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between px-3 py-1">
        <Tap accessibilityRole="button" accessibilityLabel="Back to my tabs" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          className="h-11 w-11 items-center justify-center">
          <Icon.Back color={colors.text} />
        </Tap>
        <Tap accessibilityRole="button" onPress={() => setPicker(true)} className="h-10 max-w-[60%] flex-row items-center border border-line-2 bg-surface px-3">
          <T mono className="text-[13px]" numberOfLines={1}>{me.name}{isAdmin ? " · admin" : ""} ▾</T>
        </Tap>
      </View>

      <ScrollView
        contentContainerClassName="gap-3 px-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.muted}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Animated.View entering={FadeInDown.duration(450)} className="gap-2 pb-2">
          {data.ended ? <Tag>closed</Tag> : <Tag live>live tab</Tag>}
          <T className="text-[30px] font-bold tracking-tight">{data.name}</T>
          {!data.ended && <>
            <T className="text-sm text-muted">Open until {when(data.expires_at)} ({hours}h left), then read-only for a day.</T>
            <View className="h-0.5 bg-surface-3"><View className="h-0.5 bg-accent" style={{ width: `${life}%` }} /></View>
          </>}
        </Animated.View>

        {data.ended && (
          <View className="gap-3 border border-line bg-surface p-4">
            <Label>Tab closed</Label>
            <T className="text-sm leading-5 text-muted">
              It closed {when(data.expires_at)}, so nothing can be added. Save the summary before {when(data.deletes_at)}, when it's deleted for good.
            </T>
            <View className="flex-row gap-2.5">
              <Btn className="flex-1" title="Summary image" onPress={() => setSheet("summary")} />
              <Btn variant="ink" className="flex-1" title="Export CSV" onPress={() => shareCsv(data).catch((e) => Alert.alert("Couldn't export", String(e?.message || e)))} />
            </View>
          </View>
        )}

        {/* keyed by person: another person's form starts empty */}
        {!data.ended && <UpiBox key={me.id} c={c} />}

        <Animated.View entering={FadeInDown.delay(80).duration(450)}><Hero c={c} onSettle={setPaying} /></Animated.View>

        <Animated.View entering={FadeInDown.delay(140).duration(450)} className="flex-row flex-wrap gap-px border border-line bg-line">
          <Tile icon={<Icon.Chart color={colors.text} size={18} />} title="Balances" sub={`${data.members.length} of ${data.capacity} people`} onPress={() => setSheet("balances")} />
          <Tile icon={<Icon.Share color={colors.text} size={18} />} title="Share" sub="Link, image" onPress={() => setSheet("share")} />
          <Tile icon={<Icon.Clock color={colors.text} size={18} />} title="Activity" sub="History" onPress={() => setSheet("activity")} />
          {isAdmin && !data.ended && (
            <Tile wide icon={<Icon.Shield color={colors.text} size={18} />} title="Admin" sub="Members, UPI IDs, delete tab" onPress={() => setSheet("admin")} />
          )}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200).duration(450)} className="mt-2 border border-line bg-surface">
          <View className="h-11 flex-row items-center justify-between border-b border-line px-4">
            <Label>Expenses</Label>
            {!!shown.length && <T mono className="text-[11px] text-muted">[ {String(shown.length).padStart(2, "0")} ]</T>}
          </View>
          {shown.length === 0 ? (
            <T className="p-4 text-sm text-muted">No expenses yet. Tap + Add expense.</T>
          ) : shown.map((e, i) => {
            const mine = e.shares[identity.me!];
            const payment = e.kind === "payment";
            return (
              <Tap key={e.id} onPress={() => setDetail(e)}
                className={`flex-row items-center gap-3 px-4 py-3.5 ${i ? "border-t border-line" : ""}`}>
                <View className="flex-1 gap-0.5">
                  <T className="text-[15px] font-medium" numberOfLines={1}>{payment ? `${label(e.paid_by)} paid ${label(payee(e))}` : e.description}</T>
                  <T className="text-xs text-muted" numberOfLines={1}>
                    {payment ? `Settled up · ${payMethod(e)}` : `${label(e.paid_by)} paid${mine ? ` · your share ${rupees(mine)}` : ""}`}
                  </T>
                </View>
                <T mono className="text-sm">{rupees(e.amount_paise)}</T>
              </Tap>
            );
          })}
        </Animated.View>
        <T className="text-center text-xs text-dim">{plural(live.length, "expense")} · updates every few seconds</T>
      </ScrollView>

      {!data.ended && (
        <Tap accessibilityRole="button" onPress={() => { setEditing(null); setSheet("form"); }}
          className="absolute right-5 h-[54px] flex-row items-center gap-2.5 bg-accent px-5"
          style={{ bottom: insets.bottom + 16, shadowColor: colors.accent, shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}>
          <Icon.Plus color={colors["accent-text"]} size={16} />
          <T className="text-[15px] font-semibold text-accent-text">Add expense</T>
        </Tap>
      )}

      <ExpenseForm key={sheet === "form" ? `form-${editing?.id ?? "new"}` : "closed"} c={c} open={sheet === "form"} editing={editing} onClose={() => setSheet(null)} />
      <ExpenseDetail c={c} e={detail} onClose={() => setDetail(null)} onEdit={startEdit} />
      <PaySheet key={paying ? `${paying.from}-${paying.to}-${paying.amount_paise}` : "none"} c={c} p={paying} onClose={() => setPaying(null)} />
      <BalancesSheet c={c} open={sheet === "balances"} onClose={() => setSheet(null)} />
      <ActivitySheet c={c} open={sheet === "activity"} onClose={() => setSheet(null)} />
      <AdminSheet c={c} open={sheet === "admin"} onClose={() => setSheet(null)} />
      <ShareSheet c={c} open={sheet === "share"} onClose={() => setSheet(null)} onImage={() => setTimeout(() => setSheet("summary"), 350)} />
      <SummarySheet data={data} open={sheet === "summary"} onClose={() => setSheet(null)} />
      <Toast msg={toast} onDone={() => setToast(null)} />
    </SafeAreaView>
  );
}

// Your balance, counting up from 0 for each person, and the payments that involve you.
function Hero({ c, onSettle }: { c: Ctx; onSettle: (p: Payment) => void }) {
  const { data, identity } = c;
  const me = c.member(identity.me!)!;
  const b = data.balances[me.id] || 0;
  const live = liveExpenses(data);
  const total = live.reduce((a, e) => a + e.amount_paise, 0);
  const shown = useCountUp(Math.abs(b), me.id);
  const mine = data.settlement.filter((p) => p.from === me.id || p.to === me.id);
  return (
    <View className="gap-3.5 border border-line bg-surface p-5">
      <View className="gap-1">
        <Label>{b > 0 ? "You get back" : b < 0 ? "You owe" : "You're all settled"}</Label>
        <T className={`text-[40px] font-bold tracking-tight ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : ""}`}>{rupees(shown)}</T>
        <T className="text-[13px] text-muted">{rupees(total)} spent · {plural(live.length, "expense")}</T>
      </View>
      {mine.map((p, i) => {
        const to = c.member(p.to);
        return (
          <View key={i} className="flex-row items-center justify-between gap-3 border-t border-line pt-3.5">
            <View className="flex-1">
              <T className="text-[13px] text-muted">{c.label(p.from)} → {c.label(p.to)}</T>
              <T mono className="text-base">{rupees(p.amount_paise)}</T>
            </View>
            {p.from === me.id && !data.ended && <Btn small variant="ink" title="Settle up" onPress={() => onSettle(p)} />}
            {p.to === me.id && !to?.upi_id && !data.ended && <T className="text-xs text-muted">Add your UPI ID to get paid</T>}
          </View>
        );
      })}
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
      <View className="h-11 flex-row items-center gap-2 border border-line bg-surface pl-3 pr-1">
        <T mono className="text-[11px] uppercase text-muted">UPI ID:</T>
        <T mono className="flex-1 text-[13px]" numberOfLines={1}>{me.upi_id}</T>
        <Btn small title="Edit" onPress={() => { setValue(me.upi_id!); setEditing(true); }} className="h-9" />
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
    <View className="gap-2 border border-line bg-surface p-4">
      <Label>Add your UPI ID so people can pay you</Label>
      <View className="flex-row gap-2">
        <Field className="flex-1" value={value} onChangeText={setValue} placeholder="name@bank" autoCapitalize="none" autoCorrect={false} maxLength={100} onSubmitEditing={save} />
        <Btn variant="ink" title="Save" busy={busy} disabled={!value.trim()} onPress={save} />
      </View>
      <Err>{error}</Err>
      {editing && <Tap onPress={() => setEditing(false)}><T className="text-sm text-accent">Cancel</T></Tap>}
    </View>
  );
}

function Tile({ icon, title, sub, onPress, wide }: { icon: React.ReactNode; title: string; sub: string; onPress: () => void; wide?: boolean }) {
  return (
    <Tap accessibilityRole="button" onPress={onPress}
      className={`gap-2 bg-surface p-3 ${wide ? "w-full flex-row items-center" : "min-w-[30%] flex-1"}`}>
      <View className="h-8 w-8 items-center justify-center border border-line">{icon}</View>
      <View className={wide ? "flex-1" : ""}>
        <T className="text-[13px] font-semibold">{title}</T>
        <T className="text-[11px] text-muted" numberOfLines={1}>{sub}</T>
      </View>
    </Tap>
  );
}
