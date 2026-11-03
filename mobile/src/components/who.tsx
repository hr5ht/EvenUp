// "Who are you?": the website's picker. Pick your name (and enter or create a password on a protected tab), or join.
import { useState } from "react";
import { ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Tap, Btn, Err, Field, Icon, Label, T } from "@/components/ui";
import { api, UPI_HINT, type Identity, type Member, type Tab } from "@/lib/api";
import { useTheme } from "@/lib/theme";

type Props = {
  slug: string; data: Tab; identity: Identity; known: boolean;
  setIdentity: (i: Identity) => void; reload: () => Promise<unknown>; onClose: () => void;
};

export function Who({ slug, data, identity, known, setIdentity, reload, onClose }: Props) {
  const { colors } = useTheme();
  const base = `/api/splits/${slug}`;
  const [step, setStep] = useState<"list" | "join" | "enter">("list");
  const [picking, setPicking] = useState<{ member: Member; legacy: boolean } | null>(null);
  const [pw, setPw] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinPw, setJoinPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const full = data.members.length >= data.capacity;

  const pick = (m: Member) => {
    const admin = m.id === data.admin_id;
    const signedIn = m.id === identity.me && (!data.protected || !!identity.token);
    // A closed tab can't be changed, so anyone can look as anyone, no password.
    const needsPassword = data.protected && !data.ended && !signedIn;
    const legacy = admin && data.admin_login && !identity.adminToken && !data.ended;
    if (!needsPassword && !legacy) {
      // The admin token stays on this phone whoever is picked: only the admin's name uses it.
      setIdentity({ me: m.id, adminToken: identity.adminToken, token: m.id === identity.me ? identity.token : null });
      onClose();
      return;
    }
    setPicking({ member: m, legacy });
    setPw("");
    setError("");
    setStep("enter");
  };

  const enter = async () => {
    if (!picking) return;
    const m = picking.member;
    setBusy(true);
    setError("");
    try {
      if (picking.legacy) {
        const { admin_token } = await api("POST", `${base}/admin-login`, { password: pw });
        setIdentity({ me: m.id, adminToken: admin_token, token: null });
      } else {
        const r = await api("POST", `${base}/members/${m.id}/enter`, { password: pw });
        setIdentity({ me: m.id, token: r.token, adminToken: r.admin_token });
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setError("");
    try {
      // Plain api(): this is a new person, not a member adding a friend.
      const { id, token } = await api("POST", `${base}/members`, { name: joinName.trim(), password: data.protected ? joinPw : null });
      setIdentity({ me: id, adminToken: identity.adminToken, token });
      await reload();
      onClose();
    } catch (err) {
      setError((err as any).status === 422 ? UPI_HINT : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const back = () => { setStep("list"); setError(""); };
  const create = picking && !picking.legacy && !picking.member.has_password;
  const title = step === "list" ? "Who are you?" : step === "join" ? "Join this tab" : picking!.member.name;

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="h-12 flex-row items-center justify-end px-2">
        {known && (
          <Tap accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="h-11 w-11 items-center justify-center">
            <Icon.X color={colors.text} />
          </Tap>
        )}
      </View>
      <ScrollView contentContainerClassName="gap-5 px-5 pb-10" keyboardShouldPersistTaps="handled">
        <Animated.View key={step} entering={FadeInDown.duration(400)} className="gap-3">
          <View className="flex-row items-center gap-2">
            <Icon.Link color={colors.muted} size={14} />
            <Label>{data.ended ? "Closed tab" : "Live tab"}</Label>
          </View>
          <T className="text-[34px] font-bold leading-10 tracking-tight">{title}</T>
          {step === "list" && (
            <T className="text-[15px] leading-6 text-muted">
              {data.protected && !data.ended
                ? "Pick your name. The first time, you create a password, so nobody else can use your name."
                : "Pick your name to open the tab."} This phone remembers it.
            </T>
          )}
        </Animated.View>

        {step === "list" && (
          <>
            <View className="gap-px border border-line bg-line">
              {data.members.map((m, i) => {
                const current = m.id === identity.me && known;
                return (
                  <Animated.View key={m.id} entering={FadeInDown.delay(80 + Math.min(i, 5) * 50).duration(400)}>
                    <Tap accessibilityRole="button" onPress={() => pick(m)}
                      className={`h-[60px] flex-row items-center gap-3 bg-surface px-4 ${current ? "border-l-2 border-accent" : ""}`}>
                      <View className={`h-8 w-8 items-center justify-center ${current ? "bg-accent" : m.id === data.admin_id ? "bg-ink" : "bg-surface-3"}`}>
                        <T mono className={`text-[13px] ${current ? "text-accent-text" : m.id === data.admin_id ? "text-ink-text" : ""}`}>
                          {m.name.slice(0, 2).toUpperCase()}
                        </T>
                      </View>
                      <T className={`flex-1 text-base font-medium ${current ? "text-accent" : ""}`} numberOfLines={1}>{m.name}</T>
                      {m.id === data.admin_id && <T mono className="border border-line-2 px-2 py-0.5 text-[11px] uppercase text-muted">admin</T>}
                      {current && <Icon.Check color={colors.accent} size={18} />}
                    </Tap>
                  </Animated.View>
                );
              })}
            </View>
            {!data.ended && (
              <Btn variant="dashed" disabled={full} onPress={() => { setStep("join"); setError(""); }}
                title={full ? `This tab is full (${data.capacity} people)` : "I'm not on the list"} />
            )}
            {data.protected && !data.ended && (
              <View className="flex-row gap-3 border border-line bg-surface p-3.5">
                <Icon.Lock color={colors.muted} size={18} />
                <T className="flex-1 text-[13px] leading-5 text-muted">This tab has passwords. After you pick your name, enter yours, or create one the first time.</T>
              </View>
            )}
          </>
        )}

        {step === "join" && (
          <Animated.View entering={FadeInDown.duration(400)} className="gap-4">
            <View className="gap-2 border border-line bg-surface p-5">
              <Label>Your name</Label>
              <Field value={joinName} onChangeText={setJoinName} maxLength={40} placeholder="As your friends know you" autoComplete="given-name" autoCapitalize="words" autoFocus />
              {data.protected && (
                <>
                  <Label className="mt-2">Create a password</Label>
                  <Field value={joinPw} onChangeText={setJoinPw} secureTextEntry maxLength={100} autoComplete="new-password" placeholder="At least 4 characters" />
                  <T className="text-[13px] text-muted">You'll need it to open the tab as you on another phone.</T>
                </>
              )}
              <T className="text-[13px] text-muted">You can add your UPI ID once you're in.</T>
              <Err>{error}</Err>
            </View>
            <Btn variant="ink" title="Join tab" busy={busy} disabled={!joinName.trim()} onPress={join} />
            <Btn variant="dashed" title="Back to the list" onPress={back} />
          </Animated.View>
        )}

        {step === "enter" && picking && (
          <Animated.View entering={FadeInDown.duration(400)} className="gap-4">
            <View className="gap-2 border border-line bg-surface p-5">
              <Label>{picking.legacy ? "Admin password" : create ? "Create a password" : "Your password"}</Label>
              <Field value={pw} onChangeText={setPw} secureTextEntry maxLength={100} autoFocus onSubmitEditing={enter}
                placeholder={create ? "At least 4 characters" : ""} autoComplete={create ? "new-password" : "current-password"} />
              <T className="text-[13px] leading-5 text-muted">
                {picking.legacy ? "This is the admin's name, so it needs the admin password."
                  : create ? `First time as ${picking.member.name}. You'll need this password to open the tab as ${picking.member.name} on another phone.`
                  : `Enter the password you created for ${picking.member.name}.`}
              </T>
              <Err>{error}</Err>
            </View>
            <Btn variant="ink" title={create ? "Create and continue" : "Unlock"} busy={busy} disabled={!pw} onPress={enter} />
            <Btn variant="dashed" title="Not you? Back to the list" onPress={back} />
          </Animated.View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
