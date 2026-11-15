// Sign in, create an account, or ask for a reset link: one form, three jobs, the website's /login in the app.
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Anim, Btn, Err, Field, Icon, Label, Logo, T, Tap } from "@/components/ui";
import { forgotPassword, signIn, signUp } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

type Mode = "signin" | "signup" | "forgot";
const MODES: Record<Mode, { title: string; sub: string; button: string; links: [string, string, Mode][] }> = {
  signin: { title: "Sign in", sub: "Your groups and friends, on any device.", button: "Sign in",
    links: [["New here?", "Create an account", "signup"], ["", "Forgot password?", "forgot"]] },
  signup: { title: "Create your account", sub: "You can add your UPI ID later, in your profile.", button: "Create account",
    links: [["Already have an account?", "Sign in", "signin"]] },
  forgot: { title: "Reset your password", sub: "We'll email you a link. It works for 15 minutes.", button: "Send reset link",
    links: [["", "Back to sign in", "signin"]] },
};

export default function Login() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === "signup" ? "signup" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const m = MODES[mode];

  const switchTo = (next: Mode) => { setMode(next); setError(""); setNote(""); };
  const done = () => (router.canGoBack() ? router.back() : router.replace("/profile"));

  const submit = async () => {
    setError("");
    setNote("");
    if (mode === "signup" && !name.trim()) return setError("Enter your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Enter your email address.");
    if (mode !== "forgot" && !password) return setError("Enter your password.");
    if (mode === "signup" && password.length < 8) return setError("Pick a password of at least 8 characters.");
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email.trim(), password);
      else if (mode === "signup") await signUp(name.trim(), email.trim(), password);
      else {
        await forgotPassword(email.trim());
        switchTo("signin");
        return setNote("If that email has an account, a reset link is on its way.");
      }
      done();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <View className="flex-row items-center justify-between px-5 py-2">
          <Logo />
          <Tap accessibilityRole="button" accessibilityLabel="Close" onPress={done}
            className="h-10 w-10 items-center justify-center rounded-full border border-line-2 bg-surface-2">
            <Icon.X color={colors.text} size={18} />
          </Tap>
        </View>
        <ScrollView contentContainerClassName="gap-7 px-5 pb-8 pt-8" keyboardShouldPersistTaps="handled">
          <Anim key={mode} entering={FadeInDown.duration(400)} className="gap-3">
            <View className="flex-row items-center gap-2.5">
              <View className="h-px w-4 bg-accent" />
              <T className="text-sm text-accent">Your account</T>
            </View>
            <T className="text-[44px] font-bold leading-[48px]">{m.title}</T>
            <T className="text-[15px] leading-6 text-muted">{m.sub}</T>
          </Anim>

          <View className="gap-4">
            {mode === "signup" && (
              <Anim entering={FadeIn.duration(250)} className="gap-2">
                <Label>Your name</Label>
                <Field value={name} onChangeText={setName} placeholder="As your friends know you" maxLength={40} autoCapitalize="words" autoComplete="name" />
              </Anim>
            )}
            <View className="gap-2">
              <Label>Email</Label>
              <Field value={email} onChangeText={setEmail} placeholder="you@example.com" maxLength={254} keyboardType="email-address"
                autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" />
            </View>
            {mode !== "forgot" && (
              <View className="gap-2">
                <Label>Password</Label>
                <View className="h-12 flex-row items-center rounded-xl border border-line-2 bg-surface pr-1">
                  <Field value={password} onChangeText={setPassword} secureTextEntry={!showPw} maxLength={128} onSubmitEditing={submit}
                    placeholder={mode === "signin" ? "Your password" : "At least 8 characters"}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    textContentType={mode === "signin" ? "password" : "newPassword"}
                    className="h-12 min-w-0 flex-1 border-0 bg-transparent" style={{ borderWidth: 0 }} />
                  <Tap accessibilityRole="button" accessibilityLabel={showPw ? "Hide password" : "Show password"} onPress={() => setShowPw(!showPw)}
                    className="h-10 justify-center px-3">
                    <T className="text-[13px] text-muted">{showPw ? "Hide" : "Show"}</T>
                  </Tap>
                </View>
              </View>
            )}
            {!!note && <T className="text-sm text-owed">{note}</T>}
            <Err>{error}</Err>
            <Btn variant="ink" title={m.button} busy={busy} onPress={submit} className="mt-1" />
          </View>

          <View className="items-center gap-3">
            {m.links.map(([lead, link, to]) => (
              <Tap key={link} accessibilityRole="link" onPress={() => switchTo(to)} hitSlop={8}>
                <T className="text-sm text-muted">{lead ? `${lead} ` : ""}<T className="text-sm font-medium text-accent">{link}</T></T>
              </Tap>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
