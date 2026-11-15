// Profile: signed out, what an account adds and the way in; signed in, who you are.
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Anim, Avatar, Btn, Icon, Logo, T, useConfirm } from "@/components/ui";
import { authed, isSignedIn, signOut, type Me } from "@/lib/auth";
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

  useFocusEffect(useCallback(() => {
    (async () => {
      if (!(await isSignedIn())) return setMe(null);
      setMe(await authed<Me>("GET", "/api/me").catch(() => null)); // a lapsed session reads as signed out
    })();
  }, []));

  const leave = async () => {
    if (!(await ask("Sign out?", "Your quick tabs stay on this phone.", "Sign out"))) return;
    await signOut();
    setMe(null);
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <View className="px-5 py-3"><Logo /></View>
      <ScrollView contentContainerClassName="gap-8 px-5 pb-36 pt-4">
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
            <View className="flex-row items-center gap-3.5 rounded-[20px] border border-line bg-surface p-5">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><Icon.Cash color={colors.accent} size={18} /></View>
              <View className="flex-1 gap-0.5">
                <T className="text-[13px] text-muted">UPI ID</T>
                <T mono className="text-[15px]" numberOfLines={1}>{me.upi_id || "Not added yet"}</T>
              </View>
            </View>
            <Btn variant="danger" title="Sign out" onPress={leave} />
          </Anim>
        ) : (
          <Anim entering={FadeInDown.delay(80).duration(450)} className="gap-5 rounded-[20px] border border-line bg-surface p-5">
            <View className="flex-row items-center gap-4">
              <View className="h-14 w-14 items-center justify-center rounded-full border border-line-2 bg-surface-2">
                <Icon.User color={colors.accent} size={24} />
              </View>
              <View className="flex-1 gap-0.5">
                <T className="text-[24px] font-bold leading-7">You're not signed in</T>
                <T className="text-[13px] text-muted">Quick tabs work without an account.</T>
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
      {confirmEl}
    </SafeAreaView>
  );
}
