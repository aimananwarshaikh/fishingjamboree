import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "assets/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["scripts/**/*.{js,mjs}"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
  {
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      // Engine must stay pure and deterministic.
      "no-restricted-globals": ["error", "Date", "process", "console"],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded RNG in state." },
        { object: "Date", property: "now", message: "Engine must be deterministic." },
      ],
    },
  },
);
