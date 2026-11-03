// Same tokens as the website (static/style.css). Values come from CSS variables set per theme in src/lib/theme.tsx.
const token = (name) => `var(--${name})`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: Object.fromEntries(
        ["bg", "surface", "surface-2", "surface-3", "line", "line-2", "text", "muted", "dim", "accent", "accent-text", "ink", "ink-text", "owe", "owed"]
          .map((n) => [n, token(n)]),
      ),
      // Sharp corners everywhere, like the site.
      borderRadius: { none: "0", DEFAULT: "0" },
    },
  },
  plugins: [],
};
