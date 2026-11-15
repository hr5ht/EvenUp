// Activity, the website's /activity: every change in your groups, newest first, by day. Tap one to open its group.
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackBar, Btn, Err, Icon, T, Tap } from "@/components/ui";
import { rupees } from "@/lib/api";
import { authed, type Me } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

type Item = { action: string; details: any; created_at: number; slug: string; group_name: string };

// What one change says: [who, what they did, to what].
function sentence(a: Item): [string, string, string] {
  const d = a.details, by = d.by || "Someone", what = d.description ? `${d.description} · ${rupees(d.amount_paise)}` : "";
  const s: Record<string, [string, string, string]> = {
    added: [by, " added ", what], edited: [by, " edited ", what], deleted: [by, " deleted ", what], restored: [by, " brought back ", what],
    created: [by, " started the group", ""], member_added: [by, " added ", d.name], member_removed: [by, " removed ", d.name],
    upi_set: [d.name, " added a UPI ID", ""], member_left: [by, " left the group", ""], renamed: [by, " renamed the group to ", d.name],
    owner_changed: [by, " handed the group to ", d.name], group_deleted: [by, " deleted the group", ""], group_restored: [by, " restored the group", ""],
  };
  return s[a.action] || [by, ` ${a.action.replace("_", " ")}`, ""];
}

function dayOf(t: number) {
  const d = new Date(t * 1000);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
}

export default function Activity() {
  const { colors } = useTheme();
  const [feed, setFeed] = useState<Item[] | null>(null);
  const [me, setMe] = useState("");
  const [error, setError] = useState("");

  useFocusEffect(useCallback(() => {
    Promise.all([authed<Item[]>("GET", "/api/me/activity"), authed<Me>("GET", "/api/me")])
      .then(([f, m]) => { setFeed(f); setMe(m.name); })
      .catch((e) => setError(e.message));
  }, []));

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <BackBar title="Activity" />
      <ScrollView contentContainerClassName="gap-1 px-5 pb-16 pt-4">
        <T className="mb-4 text-[13px] text-muted">Every change in your groups, newest first.</T>
        <Err>{error}</Err>
        {feed === null ? (!error && <T className="text-sm text-muted">Loading…</T>) : feed.length === 0 ? (
          <View className="items-center gap-2 rounded-[20px] border border-dashed border-line-2 px-6 py-8">
            <View className="mb-2 h-12 w-12 items-center justify-center rounded-2xl bg-surface-2"><Icon.History color={colors.accent} size={22} /></View>
            <T className="text-[22px] font-bold">Nothing here yet</T>
            <T className="text-center text-sm leading-5 text-muted">When anyone in your groups adds, edits or settles an expense, it shows up here.</T>
            <Btn small variant="ink" title="Back to Home" onPress={() => router.replace("/")} className="mt-2" />
          </View>
        ) : feed.map((a, i) => {
          const day = dayOf(a.created_at);
          const [name, verb, what] = sentence(a);
          return (
            <View key={i}>
              {(!i || dayOf(feed[i - 1].created_at) !== day) && <T className={`px-3 pb-2 text-[13px] text-muted ${i ? "pt-5" : ""}`}>{day}</T>}
              <Tap onPress={() => router.push(`/g/${a.slug}`)} className="flex-row items-center gap-3 rounded-2xl px-3 py-3">
                <View className="h-9 w-9 items-center justify-center rounded-full bg-surface-2"><Icon.History color={colors.accent} size={16} /></View>
                <View className="flex-1 gap-0.5">
                  <T className="text-[15px] leading-5 text-muted">
                    <T className="font-medium">{name === me ? "You" : name}</T>{verb}{!!what && <T className="font-medium">{what}</T>}
                  </T>
                  <T className="text-xs text-dim" numberOfLines={1}>
                    {a.group_name} · {new Date(a.created_at * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                  </T>
                </View>
                <Icon.Chev color={colors.dim} size={16} />
              </Tap>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
