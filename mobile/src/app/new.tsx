// Open a tab: same form and rules as the website's /new. You go first and become the admin.
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, Share, Switch, View } from "react-native";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Tap, Btn, Err, Field, Icon, Label, T } from "@/components/ui";
import { api, saveIdentity, tabUrl } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const MIN = 2, MAX = 50; // same cap as the server

export default function NewTab() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ name?: string }>();
  const [name, setName] = useState(params.name ?? "");
  const [people, setPeople] = useState(MIN);
  const [addNames, setAddNames] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null); // slug
  const [copied, setCopied] = useState(false);

  const setName_i = (i: number, v: string) => setNames((n) => Object.assign([...n], { [i]: v }));

  const create = async () => {
    setError("");
    if (!name.trim()) return setError("Enter your name.");
    if (protect && password.length < 4) return setError("Pick a password, at least 4 characters.");
    setBusy(true);
    try {
      const others = addNames ? names.slice(0, people - 1).map((n) => n?.trim()).filter(Boolean) : [];
      const { slug, admin_token, admin_id } = await api("POST", "/api/splits", {
        members: [{ name: name.trim() }, ...others.map((n) => ({ name: n }))],
        size: people,
        admin_password: protect ? password : null,
        website: "",
      });
      // No passwords: this phone opens the tab as you. Protected: you sign in with your password like everyone.
      await saveIdentity(slug, protect ? {} : { me: admin_id, adminToken: admin_token });
      setCreated(slug);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const link = tabUrl(created);
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <ScrollView contentContainerClassName="gap-6 px-5 pt-20">
          <Animated.View entering={ZoomIn.duration(400)} className="h-16 w-16 items-center justify-center border border-accent">
            <Icon.Check color={colors.accent} size={30} />
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(100).duration(400)} className="gap-2.5">
            <T mono className="text-[11px] uppercase tracking-[1px] text-owed">[ Tab opened ]</T>
            <T className="text-[32px] font-bold leading-9 tracking-tight">Send this link to the group</T>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(180).duration(400)} className="flex-row items-center gap-2 border border-text bg-surface py-1.5 pl-3.5 pr-1.5">
            <T mono className="flex-1 text-sm" numberOfLines={1}>{link.replace(/^https?:\/\//, "")}</T>
            <Btn small title={copied ? "Copied" : "Copy"} onPress={async () => {
              await Clipboard.setStringAsync(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }} />
          </Animated.View>
          <T className="text-[15px] leading-6 text-muted">
            {protect
              ? "Everyone opens the same link, picks their name and creates a password. Yours asks for the one you just set."
              : "Everyone opens the same link and picks their name."}
          </T>
          <View className="flex-row gap-2.5 border border-line bg-surface p-3.5">
            <Icon.Check color={colors.muted} size={16} />
            <T className="flex-1 text-[13px] leading-5 text-muted">Saved on this phone. It's in My tabs, so you don't need to keep the link.</T>
          </View>
        </ScrollView>
        <View className="gap-2.5 px-5 pb-2 pt-4">
          <Btn variant="accent" title="Share link" icon={<Icon.Share color={colors["accent-text"]} size={18} />}
            onPress={() => Share.share({ message: `Add what you paid on QuickTab, we'll settle up with UPI. ${link}`, url: link }).catch(() => {})} />
          <Btn title="Open the tab" onPress={() => router.replace(`/g/${created}`)} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-row items-center gap-1 px-3 py-1">
        <Tap accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} className="h-11 w-11 items-center justify-center">
          <Icon.Back color={colors.text} />
        </Tap>
        <Label>[ New tab ]</Label>
      </View>
      <ScrollView contentContainerClassName="gap-6 px-5 pb-6" keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <T className="text-[32px] font-bold leading-9 tracking-tight">Open a tab{"\n"}<T className="text-[32px] font-bold text-accent">for the group.</T></T>
          <T className="text-sm text-muted">Open for 48 hours. Nobody signs up.</T>
        </View>

        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <Label>Your name</Label>
            <T mono className="border border-line-2 px-1.5 text-[10px] uppercase text-muted">admin</T>
          </View>
          <Field value={name} onChangeText={setName} placeholder="Your name" maxLength={40} autoCapitalize="words" />
        </View>

        <View className="gap-px border border-line bg-line">
          <Opt title="People" sub="Including you, the most allowed">
            <View className="flex-row items-center border border-line-2">
              <Tap accessibilityLabel="One less" disabled={people === MIN} onPress={() => setPeople(people - 1)}
                className={`h-10 w-10 items-center justify-center ${people === MIN ? "opacity-30" : ""}`}>
                <T className="text-lg">−</T>
              </Tap>
              <T mono className="w-9 text-center text-base">{people}</T>
              <Tap accessibilityLabel="One more" disabled={people === MAX} onPress={() => setPeople(people + 1)}
                className={`h-10 w-10 items-center justify-center ${people === MAX ? "opacity-30" : ""}`}>
                <T className="text-lg">+</T>
              </Tap>
            </View>
          </Opt>
          <Opt title="Add names now" sub="Or everyone adds themselves from the link">
            <Switch value={addNames} onValueChange={setAddNames} trackColor={{ true: colors.accent }} />
          </Opt>
          {addNames && (
            <View className="gap-2 bg-surface px-4 pb-4">
              {Array.from({ length: people - 1 }, (_, i) => (
                <Field key={i} value={names[i] ?? ""} onChangeText={(v) => setName_i(i, v)} placeholder="Name" maxLength={40} autoCapitalize="words" />
              ))}
              <T className="text-xs leading-4 text-muted">Leave any blank: they tap "I'm not on the list" and add themselves.</T>
            </View>
          )}
          <Opt title="Password protect" sub={protect ? "Everyone signs in with their own password" : "Off: anyone can pick any name"}>
            <Switch value={protect} onValueChange={setProtect} trackColor={{ true: colors.accent }} />
          </Opt>
          {protect && (
            <View className="gap-2 bg-surface px-4 pb-4">
              <Field value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" maxLength={100}
                placeholder="Your password, at least 4 characters" />
              <T className="text-xs leading-4 text-muted">You need it to open the tab as the admin, on this phone too. Everyone else creates their own the first time they pick their name.</T>
            </View>
          )}
        </View>
        <Err>{error}</Err>
      </ScrollView>
      <View className="px-5 pb-2 pt-3">
        <Btn variant="accent" title="Open tab" busy={busy} onPress={create} icon={<Icon.Arrow color={colors["accent-text"]} size={16} />} />
      </View>
    </SafeAreaView>
  );
}

function Opt({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-4 bg-surface p-4">
      <View className="flex-1 gap-0.5">
        <T className="text-[15px] font-semibold">{title}</T>
        <T className="text-xs text-muted">{sub}</T>
      </View>
      {children}
    </View>
  );
}
