import { defineConfig } from 'vite-plus'

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    semi: false,
    singleQuote: true,
  },
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc', 'import', 'node'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ['**/dist/**', '**/.wrangler/**', '**/worker-configuration.d.ts'],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      // Workers cancel promises nobody awaits, so a dropped promise is a silent bug.
      'typescript/no-floating-promises': 'error',
      'typescript/no-misused-promises': 'error',
      'typescript/no-explicit-any': 'error',
    },
    overrides: [
      {
        // Packages take configuration as arguments; process.env would be a hidden input.
        files: ['packages/*/src/**'],
        rules: { 'node/no-process-env': 'error' },
      },
      {
        // Tests build typed values through helpers instead of casting with `as`.
        files: ['**/*.test.ts', 'tests/**'],
        rules: {
          'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
        },
      },
    ],
  },
  run: {
    cache: { scripts: false, tasks: true },
    tasks: {
      // The pre-commit hook and CI run these same tasks.
      'check:commit': { command: 'vp check', cache: false },
      'check:push': {
        command: ['vp check', 'vp test', 'vp run -r build'],
        cache: false,
      },
    },
  },
})
