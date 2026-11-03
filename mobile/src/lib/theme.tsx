// The website's dark palette (static/style.css, dark :root). The app is dark only.
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { vars as cssVars } from "nativewind";

const colors = {
  bg: "#0b0b0a", surface: "#121211", "surface-2": "#181817", "surface-3": "#232321", line: "#242422", "line-2": "#363632",
  text: "#f2f1ee", muted: "#9a988f", dim: "#63615b", accent: "#6b84ff", "accent-text": "#ffffff",
  ink: "#f2f1ee", "ink-text": "#0b0b0a", owe: "#ff6b70", owed: "#3ccf8e",
};
export type Colors = typeof colors;

export const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: 'ui-monospace, "SF Mono", Menlo, monospace' });

// The colour variables as a style: on the app's root, and on each pop-up's root (they render in their own native window).
const vars = cssVars(Object.fromEntries(Object.entries(colors).map(([k, v]) => [`--${k}`, v])));

const ThemeContext = createContext({ colors, vars });
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Web only: sheets render in a portal outside the themed view, so the colours also go on :root. Through a <style>
  // tag, not <html style>: NativeWind watches the html element and throws when its attributes change.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const tag = document.createElement("style");
    tag.textContent = `:root{${Object.entries(colors).map(([k, v]) => `--${k}:${v}`).join(";")}}`;
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);
  return (
    <ThemeContext.Provider value={{ colors, vars }}>
      <View style={[{ flex: 1 }, vars]}>{children}</View>
    </ThemeContext.Provider>
  );
}
