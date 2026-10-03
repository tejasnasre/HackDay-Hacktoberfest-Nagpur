// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // src/shared holds components copied in from reacticx; keep them as shipped.
    ignores: ["dist/*", "example/*", "src/shared/*"],
  }
]);
