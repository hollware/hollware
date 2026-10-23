import { defineConfig } from 'vite-plus'

export const generated = [
  '**/dist/**',
  '**/.wrangler/**',
  '**/worker-configuration.d.ts',
  '**/migrations/meta/**',
  'packages/create-hollware/template/**',
  'packages/admin/app/components.d.ts',
]

export const fixtures = ['tests/fixtures/content/**']

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    semi: false,
    singleQuote: true,
    ignorePatterns: [...generated, ...fixtures],
  },
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc', 'import', 'node'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: generated,
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      'typescript/no-floating-promises': 'error',
      'typescript/no-misused-promises': 'error',
      'typescript/no-explicit-any': 'error',
      'typescript/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
      ],
    },
    overrides: [
      {
        files: ['packages/*/src/**'],
        rules: { 'node/no-process-env': 'error' },
      },
      {
        files: ['**/*.test.ts', 'tests/**'],
        rules: {
          'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
        },
      },
      {
        files: ['**/*.workerd.test.ts'],
        rules: { 'vite-plus/prefer-vite-plus-imports': 'off' },
      },
    ],
  },
  test: {
    projects: [
      'packages/*',
      'packages/*/vitest.*.config.ts',
      'apps/*/vitest.config.ts',
      'apps/*/vitest.*.config.ts',
      'templates/*/vitest.config.ts',
      'examples/*/vitest.config.ts',
      {
        test: {
          name: 'repo',
          include: ['scripts/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['tests/acceptance/**', 'tests/conformance/**', 'tests/e2e/**'],
          environment: 'node',
        },
      },
    ],
  },
  run: {
    cache: { scripts: false, tasks: true },
    tasks: {
      'check:commit': { command: 'vp check', cache: false },
      bench: {
        command:
          "vp test bench --project '@hollware/core (bench)' packages/core/bench/markdown.bench.ts",
        cache: false,
      },
      'check:budgets': { command: 'node scripts/check-budgets.ts', cache: false },
      'test:acceptance': {
        command: 'vp test run --config tests/acceptance/vitest.config.ts',
        cache: false,
      },
      'e2e:admin': {
        command: 'playwright test -c tests/e2e/playwright.config.ts',
        cache: false,
      },
      'e2e:install': { command: 'node scripts/e2e-install.ts', cache: false },
      'e2e:upgrade': { command: 'node scripts/e2e-upgrade.ts', cache: false },
      'e2e:integrations': {
        command:
          'vp test run --project playground:harness apps/playground/test/harness/nuxt-site.test.ts apps/playground/test/harness/astro-site.test.ts apps/playground/test/harness/react-router-site.test.ts',
        cache: false,
      },
      'eval:search': { command: 'node scripts/eval-search.ts', cache: false },
      'test:conformance': {
        command: [
          'vp test run --config tests/conformance/vitest.config.ts',
          'node tests/conformance/run.ts',
        ],
        cache: false,
      },
      'check:local': {
        command: [
          'node scripts/commit-subjects.ts',
          'vp run check:push',
          'vp run test:acceptance',
          'vp run e2e:admin',
          'vp run test:conformance',
        ],
        cache: false,
      },
      'check:push': {
        command: [
          'vp check',
          'vp test',
          'vp run bench',
          'vp run -r build',
          'vp run check:budgets',
          'node scripts/check-bins.ts',
          'vp run -r publint',
          'vp run -r types:check',
        ],
        cache: false,
      },
    },
  },
})
