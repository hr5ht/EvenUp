// My tabs: every tab this phone opened or created, with who you are in it. No account, so this list is the account.
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Anim, Tap, Btn, Err, Field, Icon, Label, Logo, T, Tag, useConfirm } from "@/components/ui";
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
      <View className="flex-row items-center justify-between px-5 py-3">
        <Logo />
      </View>

      <ScrollView
        contentContainerClassName="gap-8 px-5 pb-8 pt-4"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.muted}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Anim entering={FadeInDown.duration(450)} className="gap-3">
          <View className="flex-row items-center gap-2.5">
            <View className="h-px w-4 bg-accent" />
            <T className="text-sm text-accent">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</T>
          </View>
          <T className="text-[48px] font-bold leading-[52px]">Your tabs</T>
        </Anim>

        <View className="gap-2.5">
          <Label>Got a link?</Label>
          <View className="h-14 flex-row items-center rounded-full border border-line-2 bg-surface pl-5 pr-1.5">
            <Field
              value={link} onChangeText={setLink} onSubmitEditing={open}
              placeholder="Paste a tab link" autoCapitalize="none" autoCorrect={false} returnKeyType="go"
              className="h-12 flex-1 border-0 bg-transparent px-0" style={{ borderWidth: 0 }}
            />
            <Btn small variant="ink" title="Open" onPress={open} className="h-11" />
          </View>
          <Err>{error}</Err>
        </View>

        <View className="gap-4">
          <View className="flex-row items-baseline gap-2.5">
            <T className="text-[30px] font-bold leading-9">Saved on this phone</T>
            {!!rows?.length && <T mono className="text-[13px] text-muted">{rows.length}</T>}
          </View>
          {rows === null ? (
            <T className="text-sm text-muted">Loading…</T>
          ) : rows.length === 0 ? (
            <View className="items-center gap-2 rounded-[20px] border border-dashed border-line-2 px-6 py-8">
              <View className="mb-2 h-12 w-12 items-center justify-center rounded-2xl bg-surface-2"><Icon.Receipt color={colors.accent} size={22} /></View>
              <T className="text-[22px] font-bold">No tabs yet</T>
              <T className="text-center text-sm leading-5 text-muted">Tap + to open a new tab, or open a link a friend sent. It's saved here with who you are, so you never have to keep the link.</T>
            </View>
          ) : (
            <View className="overflow-hidden rounded-[20px] border border-line bg-surface p-1.5">
              {rows.map((r, i) => (
                <Anim key={r.slug} entering={FadeInDown.delay(i * 50).duration(350)}>
                  <TabCard row={r} first={i === 0} onPress={() => router.push(`/g/${r.slug}`)} onLongPress={() => remove(r.slug)} />
                </Anim>
              ))}
            </View>
          )}
          {!!rows?.length && <T className="text-xs text-dim">Hold a tab to remove it from this phone.</T>}
        </View>
      </ScrollView>

      {confirmEl}
    </SafeAreaView>
  );
}

// One tab as a list row, like the website's Home: a receipt icon, the name with a time-left tag, who you are,
// and where you stand in serif, green or red.
function TabCard({ row, first, onPress, onLongPress }: { row: Row; first: boolean; onPress: () => void; onLongPress: () => void }) {
  const { colors } = useTheme();
  const t = row.data;
  const line = first ? "" : "border-t border-line";
  if (!t) {
    return (
      <Tap onPress={onPress} onLongPress={onLongPress} className={`gap-1 rounded-2xl px-3.5 py-4 ${line}`}>
        <T className="font-medium">Tab {row.slug.slice(0, 6)}</T>
        <T className="text-sm text-muted">{row.error}</T>
      </Tap>
    );
  }
  const me = t.members.find((m) => m.id === row.identity.me);
  const b = me ? t.balances[me.id] || 0 : 0;
  const { hours } = lifeOf(t);
  return (
    <Tap onPress={onPress} onLongPress={onLongPress} className={`flex-row items-center gap-3.5 px-3.5 py-4 ${line} ${t.ended ? "opacity-60" : ""}`}>
      <View className="h-11 w-11 items-center justify-center rounded-full border border-line-2 bg-surface-2">
        <Icon.Receipt color={colors.accent} size={19} />
      </View>
      <View className="flex-1 gap-1.5">
        <T className="text-[20px] font-bold leading-6" numberOfLines={1}>{tabTitle(t)}</T>
        <View className="flex-row items-center gap-2">
          {t.ended ? <Tag>closed</Tag> : <Tag live>{hours}h left</Tag>}
          <T className="flex-1 text-[13px] text-muted" numberOfLines={1}>
            {me ? `${me.name}${me.id === t.admin_id ? " · admin" : ""}` : "Pick your name"}
          </T>
        </View>
      </View>
      {me && (
        <View className="items-end gap-0.5">
          {!!b && <T className="text-xs text-muted">{b > 0 ? "You get back" : "You owe"}</T>}
          <T className={`font-bold ${b ? "text-[20px]" : "text-base text-muted"} ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : ""}`}>
            {b ? rupees(Math.abs(b)) : "Settled"}
          </T>
        </View>
      )}
    </Tap>
  );
}
