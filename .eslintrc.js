// .eslintrc.js
module.exports = {
  extends: ["next", "next/core-web-vitals", "eslint:recommended"],
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "react-hooks/exhaustive-deps": "off",
    "@next/next/no-img-element": "off",
    "@next/next/no-assign-module-variable": "off"
  }
};
