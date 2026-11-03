// Light and dark palettes from the website (static/style.css :root). Follows the phone, with a toggle remembered per device.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform, useColorScheme, View } from "react-native";
import { vars } from "nativewind";

const light = {
  bg: "#fafaf9", surface: "#ffffff", "surface-2": "#f4f4f2", "surface-3": "#ebeae7", line: "#e7e5e2", "line-2": "#d4d2ce",
  text: "#0d0d0c", muted: "#6b6963", dim: "#a19f99", accent: "#2b4bff", "accent-text": "#ffffff",
  ink: "#0d0d0c", "ink-text": "#ffffff", owe: "#e5484d", owed: "#11995a",
};
const dark: typeof light = {
  bg: "#0b0b0a", surface: "#121211", "surface-2": "#181817", "surface-3": "#232321", line: "#242422", "line-2": "#363632",
  text: "#f2f1ee", muted: "#9a988f", dim: "#63615b", accent: "#6b84ff", "accent-text": "#ffffff",
  ink: "#f2f1ee", "ink-text": "#0b0b0a", owe: "#ff6b70", owed: "#3ccf8e",
};
export type Colors = typeof light;

export const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: 'ui-monospace, "SF Mono", Menlo, monospace' });

const asVars = (c: Colors) => vars(Object.fromEntries(Object.entries(c).map(([k, v]) => [`--${k}`, v])));
const VARS = { light: asVars(light), dark: asVars(dark) };

type Ctx = { colors: Colors; dark: boolean; toggle: () => void };
const ThemeContext = createContext<Ctx>({ colors: light, dark: false, toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

const KEY = "quicktab:theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [choice, setChoice] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => (v === "light" || v === "dark") && setChoice(v)).catch(() => {});
  }, []);
  const isDark = (choice ?? system) === "dark";
  // Web only: sheets render in a portal outside the themed view, so the colours also go on :root. Through a <style>
  // tag, not <html style>: NativeWind watches the html element and throws when its attributes change.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let tag = document.getElementById("quicktab-theme");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "quicktab-theme";
      document.head.appendChild(tag);
    }
    tag.textContent = `:root{${Object.entries(isDark ? dark : light).map(([k, v]) => `--${k}:${v}`).join(";")}}`;
  }, [isDark]);
  const toggle = () => {
    const next = isDark ? "light" : "dark";
    setChoice(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  };
  return (
    <ThemeContext.Provider value={{ colors: isDark ? dark : light, dark: isDark, toggle }}>
      <View style={[{ flex: 1 }, VARS[isDark ? "dark" : "light"]]}>{children}</View>
    </ThemeContext.Provider>
  );
}
