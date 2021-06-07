module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
    'unused-imports',
  ],
  extends: [
    // 'eslint:recommended',
    // 'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": 1,
    "unused-imports/no-unused-imports-ts": 1,
    "no-shadow": 1
  }
};