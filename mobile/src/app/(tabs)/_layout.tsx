// Home and Profile share a bottom bar, like the website on phones: Home on the left, Profile on the right, and a
// raised + floating over the middle. Signed in it asks what to start (a tab or a group); signed out it opens a new tab.
import { router } from "expo-router";
import { useState } from "react";
import { Tabs } from "expo-router/js-tabs";
import { Pressable, View } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { NewFlow } from "@/components/people";
import { Icon, T, Tap } from "@/components/ui";
import { isSignedIn } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

const ITEMS = { index: { title: "Home", icon: Icon.Home }, profile: { title: "Profile", icon: Icon.User } } as const;
const BAR = "#0d0d0f";
const SIZE = 62;

// The + : a pearl-white disc with a soft light from above, a ring the colour of the bar so it looks set into it,
// a faint glow under it, and a small spring when pressed.
function NewButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const press = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <View pointerEvents="box-none" className="absolute left-0 right-0 items-center" style={{ top: -SIZE / 2 - 4 }}>
      <View className="items-center justify-center rounded-full" style={{ width: SIZE + 12, height: SIZE + 12, backgroundColor: BAR }}>
        <Reanimated.View style={[{
          width: SIZE, height: SIZE, borderRadius: SIZE / 2,
          shadowColor: colors.accent, shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
        }, press]}>
          <Pressable accessibilityRole="button" accessibilityLabel="New" onPress={onPress}
            onPressIn={() => scale.set(withSpring(0.9, { damping: 15, stiffness: 400 }))}
            onPressOut={() => scale.set(withSpring(1, { damping: 12, stiffness: 300 }))}
            className="h-full w-full items-center justify-center">
            <Svg width={SIZE} height={SIZE} style={{ position: "absolute" }}>
              <Defs>
                <LinearGradient id="pearl" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#ffffff" />
                  <Stop offset="1" stopColor="#e4e1d8" />
                </LinearGradient>
              </Defs>
              <Circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} fill="url(#pearl)" />
              <Circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 0.75} fill="none" stroke={colors.accent} strokeOpacity={0.55} strokeWidth={1.5} />
            </Svg>
            <View style={{ zIndex: 1 }}><Icon.Plus color={colors["ink-text"]} size={26} /></View>
          </Pressable>
        </Reanimated.View>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const [step, setStep] = useState<"new" | "group" | null>(null);
  const plus = () => isSignedIn().then((yes) => (yes ? setStep("new") : router.push("/new")));
  return (
    <>
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={({ state, navigateToTab, insets }) => {
        const item = (i: number) => {
          const route = state.routes[i];
          const { title, icon: Glyph } = ITEMS[route.name as keyof typeof ITEMS];
          const on = state.index === i;
          return (
            <Tap key={route.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => navigateToTab(route.key)}
              className="flex-1 items-center justify-center gap-1 py-2">
              <Glyph color={on ? colors.accent : colors.muted} size={22} />
              <T className={`text-xs ${on ? "text-accent" : "text-muted"}`}>{title}</T>
            </Tap>
          );
        };
        return (
          <View className="flex-row items-center border-t border-line px-8 pt-1.5" style={{ paddingBottom: insets.bottom + 6, backgroundColor: BAR }}>
            {item(0)}
            <View style={{ width: SIZE + 24 }} />
            {item(1)}
            <NewButton onPress={plus} />
          </View>
        );
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="profile" />
    </Tabs>
    <NewFlow step={step} setStep={setStep} />
    </>
  );
}
