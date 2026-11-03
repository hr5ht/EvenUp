// My tabs: every tab this phone opened or created, with who you are in it. No account, so this list is the account.
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Anim, Tap, Btn, Err, Field, Icon, Label, Logo, T, Tag, ThemeButton, useConfirm } from "@/components/ui";
import { api, ApiError, forgetTab, rupees, savedTabs, slugFrom, tabTitle, lifeOf, type Identity, type Tab } from "@/lib/api";
import { useTheme } from "@/lib/theme";

type Row = { slug: string; identity: Identity; data?: Tab; error?: string };

export default function Home() {
  const { colors } = useTheme();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const saved = await savedTabs();
    const loaded = await Promise.all(saved.map(async ({ slug, addedAt, ...identity }): Promise<Row | null> => {
      try {
        return { slug, identity, data: await api<Tab>("GET", `/api/splits/${slug}`) };
      } catch (err) {
        // Gone for good (a day after it closed, or the admin deleted it): drop it from the phone too.
        if (err instanceof ApiError && err.status === 404) {
          await forgetTab(slug);
          return null;
        }
        return { slug, identity, error: (err as Error).message };
      }
    }));
    setRows(loaded.filter((r): r is Row => r !== null));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = () => {
    const slug = slugFrom(link);
    if (!slug) return setError("Paste the link someone sent you.");
    setError("");
    setLink("");
    router.push(`/g/${slug}`);
  };

  const [confirmEl, ask] = useConfirm();
  const remove = async (slug: string) => {
    if (!(await ask("Remove from this phone?", "The tab stays open for everyone else. You can open it again from the link.", "Remove"))) return;
    await forgetTab(slug);
    load();
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between border-b border-line px-5 py-3">
        <Logo />
        <ThemeButton />
      </View>

      <ScrollView
        contentContainerClassName="gap-6 px-5 pb-8 pt-5"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.muted}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <View className="gap-2.5">
          <Label>Got a link?</Label>
          <View className="flex-row border border-text bg-surface">
            <View className="justify-center pl-3"><T mono className="text-accent">&gt;</T></View>
            <Field
              value={link} onChangeText={setLink} onSubmitEditing={open}
              placeholder="Paste a tab link" autoCapitalize="none" autoCorrect={false} returnKeyType="go"
              className="flex-1 border-0" style={{ borderWidth: 0 }}
            />
            <Tap accessibilityRole="button" onPress={open} className="justify-center bg-ink px-4">
              <T className="font-semibold text-ink-text">Open</T>
            </Tap>
          </View>
          <Err>{error}</Err>
        </View>

        <View className="gap-2.5">
          <View className="flex-row items-center justify-between">
            <Label>[ Saved on this phone ]</Label>
            {rows && <T mono className="text-[11px] text-muted">{String(rows.length).padStart(2, "0")}</T>}
          </View>
          {rows === null ? (
            <T className="text-sm text-muted">Loading…</T>
          ) : rows.length === 0 ? (
            <View className="gap-1 border border-dashed border-line-2 p-5">
              <T className="font-semibold">No tabs yet</T>
              <T className="text-sm leading-5 text-muted">Open a new tab, or open a link a friend sent. It's saved here with who you are, so you never have to keep the link.</T>
            </View>
          ) : (
            <View className="gap-px border border-line bg-line">
              {rows.map((r, i) => (
                <Anim key={r.slug} entering={FadeInDown.delay(i * 50).duration(350)}>
                  <TabCard row={r} onPress={() => router.push(`/g/${r.slug}`)} onLongPress={() => remove(r.slug)} />
                </Anim>
              ))}
            </View>
          )}
          {!!rows?.length && <T className="text-xs text-dim">Hold a tab to remove it from this phone.</T>}
        </View>
      </ScrollView>

      <SafeAreaView edges={["bottom"]} className="border-t border-line bg-bg">
        <View className="gap-2.5 px-5 pb-2 pt-4">
          <Btn variant="ink" title="Open a new tab" icon={<Icon.Plus color={colors["ink-text"]} size={16} />} onPress={() => router.push("/new")} />
        </View>
      </SafeAreaView>
      {confirmEl}
    </SafeAreaView>
  );
}

function TabCard({ row, onPress, onLongPress }: { row: Row; onPress: () => void; onLongPress: () => void }) {
  const t = row.data;
  if (!t) {
    return (
      <Tap onPress={onPress} onLongPress={onLongPress} className="gap-1 bg-surface p-4">
        <T className="font-semibold">Tab {row.slug.slice(0, 6)}</T>
        <T className="text-sm text-muted">{row.error}</T>
      </Tap>
    );
  }
  const me = t.members.find((m) => m.id === row.identity.me);
  const b = me ? t.balances[me.id] || 0 : 0;
  const { hours, pct: life } = lifeOf(t);
  return (
    <Tap onPress={onPress} onLongPress={onLongPress} className="gap-2.5 bg-surface p-4">
      <View className="flex-row items-center justify-between gap-3">
        <T className={`flex-1 text-base font-semibold ${t.ended ? "text-muted" : ""}`} numberOfLines={1}>{tabTitle(t)}</T>
        {t.ended ? <Tag>closed</Tag> : <Tag live>{hours}h left</Tag>}
      </View>
      <View className="flex-row items-baseline justify-between gap-3">
        <T className="flex-1 text-[13px] text-muted" numberOfLines={1}>
          {me ? `You're ${me.name}${me.id === t.admin_id ? " · admin" : ""}` : "Pick your name to open it"}
        </T>
        {me && (
          <T mono className={`text-[15px] ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-muted"}`}>
            {b > 0 ? `get ${rupees(b)}` : b < 0 ? `owe ${rupees(-b)}` : "settled"}
          </T>
        )}
      </View>
      {!t.ended && <View className="h-0.5 bg-surface-3"><View className="h-0.5 bg-accent" style={{ width: `${life}%` }} /></View>}
    </Tap>
  );
}
