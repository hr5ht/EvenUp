import "../../global.css";
import { InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold } from "@expo-google-fonts/instrument-sans";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "@/lib/theme";

// NativeWind 4 registers className on every core component at startup, ImageBackground included, which
// React Native 0.88 warns is deprecated. The app never uses it; drop when NativeWind stops touching it.
LogBox.ignoreLogs(["ImageBackground is deprecated"]);

function Screens() {
  const { colors } = useTheme();
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: "slide_from_right" }} />
    </>
  );
}

export default function RootLayout() {
  const [fontsReady] = useFonts({ InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSerif_400Regular });
  if (!fontsReady) return null; // a moment on first open; the splash screen covers it
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Screens />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
