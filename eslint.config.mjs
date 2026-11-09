import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** ESLint flat config: Next.js + React + hooks + jsx-a11y (accessibility) + TypeScript rules. */
const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts", "public/**"],
  },
  {
    rules: {
      // Unused values are bugs waiting to happen; a leading underscore marks an intentional omission.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    // Tests mock browser/SDK internals, which needs a little more typing flexibility.
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-non-null-assertion": "off" },
  },
];

export default config;
