// Profile, signed out. Quick tabs need no account; signing in is for groups and friends, which live on the website
// until the app has its own sign in.
import * as Linking from "expo-linking";
import { View } from "react-native";
import { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Anim, Btn, Icon, Logo, T } from "@/components/ui";
import { BASE } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const PERKS = [
  ["Groups that stay", "For a flat, a team or family. They never expire."],
  ["Friends", "Add people by email and split with them again and again."],
  ["Your UPI ID once", "It follows you into every group, so people can pay you."],
] as const;

export default function Profile() {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <View className="px-5 py-3"><Logo /></View>
      <View className="flex-1 gap-8 px-5 pt-4">
        <Anim entering={FadeInDown.duration(450)} className="gap-3">
          <View className="flex-row items-center gap-2.5">
            <View className="h-px w-4 bg-accent" />
            <T className="text-sm text-accent">Your account</T>
          </View>
          <T className="text-[48px] font-bold leading-[52px]">Profile</T>
        </Anim>

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
            <Btn variant="ink" title="Sign in" onPress={() => Linking.openURL(`${BASE}/login`)} />
            <T className="text-center text-xs text-dim">Opens QuickTab in your browser for now</T>
          </View>
        </Anim>
      </View>
    </SafeAreaView>
  );
}
