import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "out/**",
    "coverage/**",
    "public/dicoms/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off",
      // The viewer predates these stricter React 19 compiler-oriented rules.
      // Keep the existing behavior during deployment hardening; migrate each
      // lifecycle deliberately with viewer smoke tests in a separate change.
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-img-element": "off",
      "@next/next/no-assign-module-variable": "off",
    },
  },
  {
    files: ["src/platform/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react/*",
                "next",
                "next/*",
                "@cornerstonejs/*",
                "@/app/*",
                "@/components/*",
                "@/extensions/*",
                "@/features/*",
                "@/hooks/*",
                "@/server/*",
              ],
              message:
                "platform/core must stay framework- and renderer-neutral.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/app/api/**",
      "src/platform/core/**",
      "src/server/**",
      "src/lib/pacs/dicomIndex.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*"],
              message: "The server boundary is only available to API/server code.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
