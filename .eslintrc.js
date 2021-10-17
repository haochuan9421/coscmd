module.exports = {
  ignorePatterns: ["**/*.js"],
  env: {
    node: true,
    es6: true,
  },
  parserOptions: {
    ecmaVersion: "latest",
  },
  extends: ["plugin:prettier/recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "no-undef": "error",
    "no-else-return": "error",
    "prefer-template": "error",
    "no-useless-concat": "error",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    "@typescript-eslint/ban-ts-comment": [
      "error",
      {
        "ts-ignore": "allow-with-description",
        minimumDescriptionLength: 1,
      },
    ],
  },
};
