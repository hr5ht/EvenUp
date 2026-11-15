// Open a tab: the website's /new in the app. The form on top, and a paper slip below that fills in as you go
// (your name, the headcount as seats, how people join) and gets an OPEN stamp once the tab exists.
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Share, View } from "react-native";
import Reanimated, { FadeInDown, Keyframe, ZoomIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Anim, Btn, EASE, Err, Field, Icon, initials, Label, Logo, T, Tap, Toggle } from "@/components/ui";
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

  const slip = <Slip name={name.trim()} people={people} protect={protect} opened={!!created} />;

  const head = (
    <View className="flex-row items-center justify-between px-5 py-2">
      <Logo />
      <Tap accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        className="h-10 flex-row items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 pl-3 pr-4">
        <Icon.Back color={colors.text} size={16} />
        <T className="text-sm font-medium">Home</T>
      </Tap>
    </View>
  );

  if (created) {
    const link = tabUrl(created);
    return (
      <SafeAreaView className="flex-1 bg-bg">
        {head}
        <ScrollView contentContainerClassName="gap-6 px-5 pb-10 pt-6">
          <Anim entering={ZoomIn.duration(400)} className="h-14 w-14 items-center justify-center rounded-full bg-owed">
            <Icon.Check color={colors["ink-text"]} size={26} />
          </Anim>
          <Anim entering={FadeInDown.delay(100).duration(400)} className="gap-3">
            <Eyebrow>Tab opened</Eyebrow>
            <T className="text-[44px] font-bold leading-[48px]">Send this link to the group</T>
          </Anim>
          <Anim entering={FadeInDown.delay(160).duration(400)} className="h-14 justify-center rounded-2xl border border-line-2 bg-surface px-5">
            <T mono className="text-sm" numberOfLines={1}>{link.replace(/^https?:\/\//, "")}</T>
          </Anim>
          <T className="text-[15px] leading-6 text-muted">
            {protect
              ? "Everyone opens the same link, picks their name and creates a password. Yours asks for the one you just set."
              : "Everyone opens the same link and picks their name."}
          </T>
          <View className="flex-row gap-2.5">
            <Btn className="flex-1" title={copied ? "Copied" : "Copy link"} onPress={async () => {
              await Clipboard.setStringAsync(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }} />
            <Btn className="flex-1" variant="ink" title="Share link"
              onPress={() => Share.share({ message: `Add what you paid on EvenUp, we'll settle up with UPI. ${link}`, url: link }).catch(() => {})} />
          </View>
          <Tap accessibilityRole="link" onPress={() => router.replace(`/g/${created}`)} className="flex-row items-center justify-center gap-2 py-2">
            <T className="text-[15px] font-medium text-accent">Open the tab</T>
            <Icon.Arrow color={colors.accent} size={16} />
          </Tap>
          <Anim entering={FadeInDown.delay(220).duration(500)}>{slip}</Anim>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      {head}
      <KeyboardAvoidingView behavior={Platform.OS === "android" ? "height" : undefined} className="flex-1">
      <ScrollView contentContainerClassName="gap-7 px-5 pb-8 pt-6" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Anim entering={FadeInDown.duration(450)} className="gap-3">
          <Eyebrow>New tab</Eyebrow>
          <T className="text-[44px] font-bold leading-[48px]">Open a tab for the group</T>
          <T className="text-[15px] leading-6 text-muted">No account needed. Open for 48 hours, read-only for a day, then deleted.</T>
        </Anim>

        <View className="gap-2">
          <View className="flex-row items-baseline justify-between">
            <Label>Your name</Label>
            <T className="text-xs text-dim">You'll be the admin</T>
          </View>
          <Field value={name} onChangeText={setName} placeholder="As your friends know you" maxLength={40} autoCapitalize="words" autoComplete="name" />
        </View>

        <View className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <Opt title="People" sub={`Including you, up to ${MAX}`}>
            <View className="h-10 flex-row items-center gap-1 rounded-full border border-line-2 bg-bg p-1">
              <Tap accessibilityLabel="One less" disabled={people === MIN} onPress={() => setPeople(people - 1)}
                className={`h-8 w-8 items-center justify-center rounded-full bg-surface-2 ${people === MIN ? "opacity-30" : ""}`}>
                <T className="text-lg leading-5">−</T>
              </Tap>
              <T className="w-9 text-center text-base font-medium" style={{ fontVariant: ["tabular-nums"] }}>{people}</T>
              <Tap accessibilityLabel="One more" disabled={people === MAX} onPress={() => setPeople(people + 1)}
                className={`h-8 w-8 items-center justify-center rounded-full bg-surface-2 ${people === MAX ? "opacity-30" : ""}`}>
                <T className="text-lg leading-5">+</T>
              </Tap>
            </View>
          </Opt>

          <Opt title="Add names now" sub="Or everyone adds themselves from the link" line>
            <Toggle label="Add names now" value={addNames} onChange={setAddNames} />
          </Opt>
          {addNames && (
            <Anim entering={FadeInDown.duration(300)} className="gap-2.5 px-4 pb-4">
              {Array.from({ length: people - 1 }, (_, i) => (
                <Field key={i} value={names[i] ?? ""} onChangeText={(v) => setName_i(i, v)} placeholder={`Person ${i + 2}`} maxLength={40} autoCapitalize="words" />
              ))}
              <T className="text-xs leading-4 text-muted">Leave any blank. They tap "I'm not on the list" and add themselves.</T>
            </Anim>
          )}

          <Opt title="Password protect" sub={protect ? "Everyone signs in with their own password" : "Off: anyone can pick any name"} line>
            <Toggle label="Password protect" value={protect} onChange={setProtect} />
          </Opt>
          {protect && (
            <Anim entering={FadeInDown.duration(300)} className="gap-2.5 px-4 pb-4">
              <Field value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" maxLength={100}
                placeholder="Your password, at least 4 characters" />
              <T className="text-xs leading-4 text-muted">You need it to open the tab as the admin, on this phone too. Everyone else creates their own the first time they pick their name.</T>
            </Anim>
          )}
        </View>

        <View className="gap-3">
          <Err>{error}</Err>
          <Btn variant="ink" title="Open tab" busy={busy} onPress={create} />
        </View>

        <View className="gap-3">
          <Label>Your tab, as it'll print</Label>
          {slip}
        </View>

        <Tap accessibilityRole="link" onPress={() => router.push({ pathname: "/login", params: { mode: "signup" } })} className="items-center py-1">
          <T className="text-sm text-muted">Want your tabs on every device? <T className="text-sm font-medium text-accent">Create an account</T></T>
        </Tap>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const Eyebrow = ({ children }: { children: string }) => {
  return (
    <View className="flex-row items-center gap-2.5">
      <View className="h-px w-4 bg-accent" />
      <T className="text-sm text-accent">{children}</T>
    </View>
  );
};

function Opt({ title, sub, line, children }: { title: string; sub: string; line?: boolean; children: React.ReactNode }) {
  return (
    <View className={`flex-row items-center justify-between gap-4 p-4 ${line ? "border-t border-line" : ""}`}>
      <View className="flex-1 gap-0.5">
        <T className="text-[15px] font-medium">{title}</T>
        <T className="text-[13px] text-muted">{sub}</T>
      </View>
      {children}
    </View>
  );
}

// The website's live receipt: who opened it, the headcount as seats (you first), how people join, the rules, and
// an OPEN stamp that lands once the tab exists.
const stampIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 1.8 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE },
}).duration(420);

function Slip({ name, people, protect, opened }: { name: string; people: number; protect: boolean; opened: boolean }) {
  const { colors } = useTheme();
  const shown = Math.min(people, 12);
  const line = (k: string, v: string, total?: boolean) => (
    <View className="flex-row justify-between py-1">
      <T mono className={`text-[12px] ${total ? "text-paper-ink" : "text-paper-2"}`}>{k}</T>
      <T mono className="text-[12px] text-paper-ink" numberOfLines={1}>{v}</T>
    </View>
  );
  const rule = <View className="my-3 border-t border-dashed border-rule" />;
  return (
    <View className="mx-4">
      <View className="rounded-t bg-paper px-6 pt-6">
        <T mono className="text-center text-[15px] tracking-[3px] text-paper-ink">NEW TAB</T>
        <T mono className="mt-1 text-center text-[11px] text-paper-2">EvenUp · opened today</T>
        {rule}
        {line("Opened by", name || "You")}
        {line("People", String(people))}
        {line("Joining", protect ? "Name + password" : "Pick a name")}
        {line("Open for", "48 hours")}
        {line("Then", "Read-only, 1 day")}
        {rule}
        <T mono className="text-[11px] text-paper-2">Seats</T>
        <View className="mt-2 flex-row flex-wrap gap-1.5">
          <View className="h-7 min-w-7 items-center justify-center rounded-full bg-paper-ink px-1.5">
            <T className="text-[10px] font-medium text-paper">{name ? initials(name) : "You"}</T>
          </View>
          {Array.from({ length: shown - 1 }, (_, i) => <View key={i} className="h-7 w-7 rounded-full border border-dashed border-paper-2" />)}
          {people > shown && <View className="h-7 items-center justify-center rounded-full px-1.5"><T className="text-[11px] text-paper-2">+{people - shown}</T></View>}
        </View>
        {rule}
        {line("Spent so far", "₹0.00", true)}
        <View className="mb-1 mt-3 h-5 flex-row justify-between opacity-80">
          {[2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 2, 1].map((w, i) => <View key={i} className="h-5 bg-paper-ink" style={{ width: w }} />)}
        </View>
        {opened && (
          // Lands with a scale on the outer view; the tilt lives on the inner one, so it stays after the landing.
          <Reanimated.View entering={stampIn} style={{ position: "absolute", right: 20, top: 210 }}>
            <View style={{ borderRadius: 6, borderWidth: 2, borderColor: colors["neg-p"], paddingHorizontal: 12, paddingVertical: 4, transform: [{ rotate: "-14deg" }] }}>
              <T mono className="text-[22px] tracking-[4px]" style={{ color: colors["neg-p"] }}>OPEN</T>
            </View>
          </Reanimated.View>
        )}
      </View>
      <Svg width="100%" height={10} viewBox="0 0 240 10" preserveAspectRatio="none">
        <Path d={`M0 0H240V2${Array.from({ length: 24 }, (_, i) => `L${240 - i * 10 - 5} 10L${240 - i * 10 - 10} 2`).join("")}Z`} fill={colors.paper} />
      </Svg>
    </View>
  );
}
