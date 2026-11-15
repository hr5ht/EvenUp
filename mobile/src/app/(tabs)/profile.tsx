// Profile: signed out, what an account adds and the way in. Signed in, the website's profile: your name and
// UPI ID, signing out, and deleting the account.
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Anim, Avatar, Btn, Err, Field, Icon, Label, Logo, T, useConfirm } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { authed, deleteAccount, isSignedIn, signOut, type Me } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

const PERKS = [
  ["Groups that stay", "For a flat, a team or family. They never expire."],
  ["Friends", "Add people by email and split with them again and again."],
  ["Your UPI ID once", "It follows you into every group, so people can pay you."],
] as const;

export default function Profile() {
  const { colors } = useTheme();
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined: still checking
  const [confirmEl, ask] = useConfirm();
  const [name, setName] = useState("");
  const [upi, setUpi] = useState("");
  const [saving, setSaving] = useState<"" | "busy" | "saved">("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const fill = (m: Me | null) => {
    setMe(m);
    setName(m?.name || "");
    setUpi(m?.upi_id || "");
  };

  useFocusEffect(useCallback(() => {
    (async () => {
      if (!(await isSignedIn())) return fill(null);
      fill(await authed<Me>("GET", "/api/me").catch(() => null)); // a lapsed session reads as signed out
    })();
  }, []));

  const save = async () => {
    setError("");
    if (!name.trim()) return setError("Enter your name.");
    setSaving("busy");
    try {
      fill(await authed<Me>("PATCH", "/api/me", { name: name.trim(), upi_id: upi.trim() || null }));
      setSaving("saved");
      setTimeout(() => setSaving(""), 1500);
    } catch (err) {
      setError((err as ApiError).status === 422 ? "That doesn't look like a UPI ID (name@bank)." : (err as Error).message);
      setSaving("");
    }
  };

  const leave = async () => {
    if (!(await ask("Sign out?", "Your tabs and groups stay on your account.", "Sign out"))) return;
    await signOut();
    fill(null);
  };

  const remove = async () => {
    setDeleteError("");
    if (!password) return setDeleteError("Enter your password.");
    if (!(await ask("Delete your account?", "This can't be undone.", "Delete"))) return;
    setDeleting(true);
    try {
      await deleteAccount(password);
      setPassword("");
      fill(null);
    } catch (err) {
      setDeleteError((err as Error).message);
    }
    setDeleting(false);
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <View className="px-5 py-3"><Logo /></View>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "android" ? "height" : undefined}>
      <ScrollView contentContainerClassName="gap-8 px-5 pb-36 pt-4" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Anim entering={FadeInDown.duration(450)} className="gap-3">
          <View className="flex-row items-center gap-2.5">
            <View className="h-px w-4 bg-accent" />
            <T className="text-sm text-accent">Your account</T>
          </View>
          <T className="text-[48px] font-bold leading-[52px]">Profile</T>
        </Anim>

        {me === undefined ? null : me ? (
          <Anim entering={FadeInDown.delay(80).duration(450)} className="gap-4">
            <View className="items-center gap-3 rounded-[20px] border border-line bg-surface px-5 py-7">
              <Avatar name={me.name} size={72} />
              <T className="text-[30px] font-bold leading-9" numberOfLines={1}>{me.name}</T>
              <T className="text-sm text-muted">{me.email}</T>
            </View>
            <View className="gap-2.5 rounded-[20px] border border-line bg-surface p-5">
              <T className="mb-1 text-[22px] font-bold">Your details</T>
              <Label>Your name</Label>
              <Field value={name} onChangeText={setName} maxLength={40} autoComplete="name" autoCapitalize="words" />
              <View className="mt-2"><Label>Your UPI ID · optional</Label></View>
              <Field value={upi} onChangeText={setUpi} maxLength={321} placeholder="name@bank" autoCapitalize="none" autoCorrect={false} />
              <T className="text-[13px] leading-5 text-muted">So friends can pay you by UPI. It's printed on your bill in every group and tab you're in.</T>
              <Err>{error}</Err>
              <Btn variant="ink" title={saving === "saved" ? "Saved" : "Save"} onPress={save} disabled={saving === "busy"} className="mt-1" />
            </View>
            <View className="gap-3 rounded-[20px] border border-line bg-surface p-5">
              <T className="text-[22px] font-bold">Session</T>
              <T className="text-[13px] text-muted">Signed in on this phone.</T>
              <Btn title="Sign out" onPress={leave} />
            </View>
            <View className="gap-2.5 rounded-[20px] border border-owe bg-surface p-5">
              <T className="text-[22px] font-bold">Delete account</T>
              <T className="text-[13px] leading-5 text-muted">This can't be undone. Your profile and friends go. Your groups pass to another member, and your part in their expenses stays so their balances still add up.</T>
              <View className="mt-1"><Label>Enter your password to confirm</Label></View>
              <Field value={password} onChangeText={setPassword} secureTextEntry maxLength={128} placeholder="Your password" autoCapitalize="none" />
              <Err>{deleteError}</Err>
              <Btn variant="danger" title="Delete my account" onPress={remove} disabled={deleting} className="mt-1" />
            </View>
          </Anim>
        ) : (
          <Anim entering={FadeInDown.delay(80).duration(450)} className="gap-5 rounded-[20px] border border-line bg-surface p-5">
            <View className="flex-row items-center gap-4">
              <View className="h-14 w-14 items-center justify-center rounded-full border border-line-2 bg-surface-2">
                <Icon.User color={colors.accent} size={24} />
              </View>
              <View className="flex-1 gap-0.5">
                <T className="text-[24px] font-bold leading-7">You're not signed in</T>
                <T className="text-[13px] text-muted">Tabs work without an account.</T>
              </View>
            </View>
            <View className="gap-3.5 border-t border-line pt-5">
              {PERKS.map(([title, sub]) => (
                <View key={title} className="flex-row gap-3">
                  <View className="mt-1"><Icon.Check color={colors.accent} size={16} /></View>
                  <View className="flex-1">
                    <T className="text-[15px] font-medium">{title}</T>
                    <T className="text-[13px] leading-5 text-muted">{sub}</T>
                  </View>
                </View>
              ))}
            </View>
            <View className="gap-2.5">
              <Btn variant="ink" title="Sign in" onPress={() => router.push("/login")} />
              <Btn title="Create an account" onPress={() => router.push({ pathname: "/login", params: { mode: "signup" } })} />
            </View>
          </Anim>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      {confirmEl}
    </SafeAreaView>
  );
}
