// Profile: signed out, what an account adds and the way in. Signed in, the website's profile: your name and
// UPI ID, signing out, and deleting the account.
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Anim, Avatar, Btn, Err, Field, Icon, Label, Logo, Sheet, T, useConfirm } from "@/components/ui";
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
  const [editing, setEditing] = useState(false); // your details read as text until you tap Edit
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false); // the password is asked in a popup, after you tap Delete
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const fill = (m: Me | null) => {
    setMe(m);
    setName(m?.name || "");
    setUpi(m?.upi_id || "");
    setEditing(false);
    setError("");
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
    setSaving(true);
    try {
      fill(await authed<Me>("PATCH", "/api/me", { name: name.trim(), upi_id: upi.trim() || null }));
    } catch (err) {
      setError((err as ApiError).status === 422 ? "That doesn't look like a UPI ID (name@bank)." : (err as Error).message);
    }
    setSaving(false);
  };

  const leave = async () => {
    if (!(await ask("Sign out?", "Your tabs and groups stay on your account.", "Sign out"))) return;
    await signOut();
    fill(null);
  };

  const remove = async () => {
    setDeleteError("");
    if (!password) return setDeleteError("Enter your password.");
    setDeleting(true);
    try {
      await deleteAccount(password);
      setPassword("");
      setDeleteOpen(false);
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
        {me === undefined ? null : me ? (
          <Anim entering={FadeInDown.delay(80).duration(450)} className="gap-4">
            <View className="items-center gap-3 rounded-[20px] border border-line bg-surface px-5 py-7">
              <Avatar name={me.name} size={72} />
              <T className="text-[30px] font-bold leading-9" numberOfLines={1}>{me.name}</T>
              <T className="text-sm text-muted">{me.email}</T>
            </View>
            <View className="gap-2.5 rounded-[20px] border border-line bg-surface p-5">
              <View className="mb-1 flex-row items-center justify-between">
                <T className="text-[22px] font-bold">Your details</T>
                {!editing && <Btn small title="Edit" onPress={() => setEditing(true)} className="h-8 px-3" />}
              </View>
              {editing ? (
                <>
                  <Label>Your name</Label>
                  <Field value={name} onChangeText={setName} maxLength={40} autoComplete="name" autoCapitalize="words" autoFocus />
                  <View className="mt-2"><Label>Your UPI ID · optional</Label></View>
                  <Field value={upi} onChangeText={setUpi} maxLength={321} placeholder="name@bank" autoCapitalize="none" autoCorrect={false} />
                  <T className="text-[13px] leading-5 text-muted">So friends can pay you by UPI. It's printed on your bill in every group and tab you're in.</T>
                  <Err>{error}</Err>
                  <View className="mt-1 flex-row gap-2.5">
                    <Btn title="Cancel" onPress={() => fill(me)} className="flex-1" />
                    <Btn variant="ink" title="Save" onPress={save} busy={saving} disabled={saving} className="flex-1" />
                  </View>
                </>
              ) : (
                <>
                  <View className="flex-row justify-between gap-3">
                    <T className="text-muted">Name</T>
                    <T className="flex-1 text-right" numberOfLines={1}>{me.name}</T>
                  </View>
                  <View className="flex-row justify-between gap-3">
                    <T className="text-muted">UPI ID</T>
                    <T mono={!!me.upi_id} className={`flex-1 text-right ${me.upi_id ? "" : "text-dim"}`} numberOfLines={1}>{me.upi_id || "Not added"}</T>
                  </View>
                </>
              )}
            </View>
            <View className="gap-3 rounded-[20px] border border-line bg-surface p-5">
              <T className="text-[22px] font-bold">Session</T>
              <T className="text-[13px] text-muted">Signed in on this phone.</T>
              <Btn title="Sign out" onPress={leave} />
            </View>
            <View className="gap-2.5 rounded-[20px] border border-owe bg-surface p-5">
              <T className="text-[22px] font-bold">Delete account</T>
              <T className="text-[13px] leading-5 text-muted">This can't be undone. Your profile and friends go. Your groups pass to another member, and your part in their expenses stays so their balances still add up.</T>
              <Btn variant="danger" title="Delete my account" onPress={() => { setPassword(""); setDeleteError(""); setDeleteOpen(true); }} className="mt-1" />
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
      <Sheet open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete account?"
        footer={<>
          <Btn title="Cancel" onPress={() => setDeleteOpen(false)} className="flex-1" />
          <Btn variant="danger" title="Delete for good" onPress={remove} busy={deleting} disabled={deleting} className="flex-1" />
        </>}>
        <T className="text-[13px] leading-5 text-muted">This can't be undone. Enter your password to confirm.</T>
        <Field value={password} onChangeText={setPassword} secureTextEntry maxLength={128} placeholder="Your password" autoCapitalize="none" autoFocus onSubmitEditing={remove} />
        <Err>{deleteError}</Err>
      </Sheet>
      {confirmEl}
    </SafeAreaView>
  );
}
