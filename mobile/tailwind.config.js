// Same tokens as the website (static/style.css). Values come from CSS variables set per theme in src/lib/theme.tsx.
const token = (name) => `var(--${name})`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  // Light/dark comes from src/lib/theme.tsx, not dark: classes. "class" also stops NativeWind's web runtime throwing
  // "Cannot manually set color scheme" when a stylesheet is added to <head> (as the dev server does).
  darkMode: "class",
  theme: {
    extend: {
      colors: Object.fromEntries(
        ["bg", "surface", "surface-2", "surface-3", "line", "line-2", "text", "muted", "dim", "accent", "accent-text", "ink", "ink-text", "owe", "owed",
          "paper", "paper-ink", "paper-2", "rule", "pos-p", "neg-p"]
          .map((n) => [n, token(n)]),
      ),
    },
  },
  plugins: [],
};
