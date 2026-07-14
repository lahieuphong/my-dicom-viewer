import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "coverage/**",
      "public/dicoms/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off",
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
];

export default eslintConfig;
