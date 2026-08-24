// Flat config. `next lint` was removed in Next 16, which is why the old script
// silently linted nothing: it treated "lint" as a directory argument.
// v16 exports a flat-config array directly, not a factory.
import next from "eslint-config-next";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "cairo/target/**",
      "out/**",
      "next-env.d.ts",
    ],
  },
  ...next,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The pool speaks in felts and wallet payloads whose shapes we adapt to at
      // runtime. Warn rather than block, so a real bug is not lost in noise.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The leak-scorer frontend is being replaced in the next milestone. Its
    // findings are downgraded so lint enforces on new code instead of drowning
    // in a surface we are about to delete. Nothing here is suppressed silently:
    // `npm run lint` still prints every one of them.
    files: [
      "src/app/**/*.{ts,tsx}",
      "src/core/{detect,decide,rewrite,fetch,fixture,clock,types}.ts",
      "src/lib/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
];
