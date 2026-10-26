module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { browser: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    'no-restricted-properties': [
      'error',
      { object: 'Math', property: 'random', message: 'Use the seeded Rng (core/Rng.ts) instead of Math.random.' },
    ],
  },
  overrides: [
    {
      files: ['src/render/**', 'src/ui/**', 'tests/**'],
      rules: { 'no-restricted-properties': 'off' },
    },
  ],
};
