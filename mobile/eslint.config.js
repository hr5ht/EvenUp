// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  // Apostrophes in <Text> are just text in React Native; the rule is for HTML.
  { rules: { "react/no-unescaped-entities": "off" } },
]);
