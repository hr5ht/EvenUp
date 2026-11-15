// The website's palette (static/app.css :root): near-black, hairlines, one brass accent, green and red only for money,
// and the cream paper of the bill. The app is dark only.
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { vars as cssVars } from "nativewind";

const colors = {
  bg: "#070708", surface: "#111114", "surface-2": "#1a1a1e", "surface-3": "#26262b", line: "#19191c", "line-2": "#27272b",
  text: "#f4f4f2", muted: "#a3a3a8", dim: "#6c6c73", accent: "#e3c79b", "accent-text": "#1a1408",
  ink: "#f4f4f2", "ink-text": "#0a0a0b", owe: "#ff7b72", owed: "#5fd39b",
  paper: "#f3efe6", "paper-ink": "#1d1a16", "paper-2": "#6f675b", rule: "#c9bfac", "pos-p": "#1d7a4c", "neg-p": "#b4432e",
};
export type Colors = typeof colors;

export const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: 'ui-monospace, "SF Mono", Menlo, monospace' });
// Instrument Serif for titles and big amounts, Instrument Sans for everything else, loaded in _layout.
export const FONTS = { serif: "InstrumentSerif_400Regular", sans: "InstrumentSans_400Regular", medium: "InstrumentSans_500Medium", semibold: "InstrumentSans_600SemiBold" };

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
