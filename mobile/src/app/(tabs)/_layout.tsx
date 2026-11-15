// Home and Profile share a bottom bar, like the website on phones: Home on the left, a round + in the middle
// that opens a new tab, Profile on the right.
import { router } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { View } from "react-native";
import { Icon, T, Tap } from "@/components/ui";
import { useTheme } from "@/lib/theme";

const ITEMS = { index: { title: "Home", icon: Icon.Home }, profile: { title: "Profile", icon: Icon.User } } as const;

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
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
          <View className="flex-row items-center border-t border-line px-6 pt-1.5" style={{ paddingBottom: insets.bottom + 6, backgroundColor: "rgba(13,13,15,0.96)" }}>
            {item(0)}
            <View className="flex-1 items-center">
              <Tap accessibilityRole="button" accessibilityLabel="Open a new tab" onPress={() => router.push("/new")}
                className="h-14 w-14 items-center justify-center rounded-full bg-ink"
                style={{ shadowColor: "#fff", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
                <Icon.Plus color={colors["ink-text"]} size={24} />
              </Tap>
            </View>
            {item(1)}
          </View>
        );
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
