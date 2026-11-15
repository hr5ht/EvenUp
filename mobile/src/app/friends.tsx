// Friends, the website's /friends: add someone by email, answer requests, and see who you split with.
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, BackBar, Btn, Err, Field, Icon, Label, Rows, T } from "@/components/ui";
import { authed } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

type Person = { id: number; name?: string; email: string };
type Lists = { friends: Person[]; requests: Person[]; sent: Person[] };

export default function Friends() {
  const { colors } = useTheme();
  const [lists, setLists] = useState<Lists | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => authed<Lists>("GET", "/api/friends").then(setLists).catch((e) => setError(e.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (method: string, url: string) => {
    setError("");
    try {
      await authed(method, url);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const add = async () => {
    setError(""); setNote("");
    if (!email.trim()) return;
    setBusy(true);
    try {
      await authed("POST", "/api/friends", { email: email.trim() });
      setNote(`Request sent to ${email.trim()}.`);
      setEmail("");
      await load();
    } catch (e) {
      setError((e as { status?: number }).status === 422 ? "That doesn't look like an email address." : (e as Error).message);
    }
    setBusy(false);
  };

  const row = (p: Person, ...acts: React.ReactNode[]) => (
    <View key={p.id} className="flex-row items-center gap-3 bg-surface px-4 py-3">
      <Avatar name={p.name || p.email} />
      <View className="flex-1 gap-0.5">
        <T className="text-[15px] font-medium" numberOfLines={1}>{p.name || p.email}</T>
        {!!p.name && <T className="text-xs text-muted" numberOfLines={1}>{p.email}</T>}
      </View>
      <View className="flex-row gap-1.5">{acts}</View>
    </View>
  );
  const small = "h-8 px-3";

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <BackBar title="Friends" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "android" ? "height" : undefined}>
        <ScrollView contentContainerClassName="gap-8 px-5 pb-16 pt-4" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View className="gap-2.5 rounded-[20px] border border-line bg-surface p-5">
            <T className="text-[13px] leading-5 text-muted">Add a friend by email. If they're new to EvenUp, your request waits until they sign up.</T>
            <Label>Their email</Label>
            <Field value={email} onChangeText={setEmail} onSubmitEditing={add} placeholder="friend@example.com"
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={254} />
            <Btn variant="ink" title="Add friend" busy={busy} onPress={add} icon={<Icon.UserPlus color={colors["ink-text"]} size={16} />} className="mt-1" />
            {!!note && <T className="text-sm text-owed">{note}</T>}
            <Err>{error}</Err>
          </View>

          {!!lists?.requests.length && (
            <View className="gap-3">
              <T className="text-[30px] font-bold leading-9">Requests</T>
              <Rows>{lists.requests.map((p) => row(p,
                <Btn key="d" small title="Decline" className={small} onPress={() => act("POST", `/api/friends/${p.id}/decline`)} />,
                <Btn key="a" small variant="ink" title="Accept" className={small} onPress={() => act("POST", `/api/friends/${p.id}/accept`)} />))}</Rows>
            </View>
          )}

          <View className="gap-3">
            <View className="flex-row items-baseline gap-2.5">
              <T className="text-[30px] font-bold leading-9">Your friends</T>
              {!!lists?.friends.length && <T mono className="text-[13px] text-muted">{lists.friends.length}</T>}
            </View>
            {lists === null ? <T className="text-sm text-muted">Loading…</T>
              : lists.friends.length ? <Rows>{lists.friends.map((p) => row(p,
                <Btn key="r" small variant="dashed" title="Remove" className={small} onPress={() => act("DELETE", `/api/friends/${p.id}`)} />))}</Rows>
              : <T className="text-sm text-muted">No friends yet. Add one by email above.</T>}
          </View>

          {!!lists?.sent.length && (
            <View className="gap-3">
              <T className="text-[30px] font-bold leading-9">Sent, waiting</T>
              <Rows>{lists.sent.map((p) => row(p,
                <Btn key="c" small variant="dashed" title="Cancel" className={small} onPress={() => act("DELETE", `/api/friends/${p.id}`)} />))}</Rows>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
