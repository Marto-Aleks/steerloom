import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Code that runs in Node (servers, build scripts, Vite/Vitest configs).
const nodeFiles = [
  'server/**/*.{ts,mjs,js}',
  'scripts/**/*.{ts,mjs,js}',
  'vite*.config.ts',
  'vitest.config.ts',
]

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-server',
      'dist-local',
      'coverage',
      'node_modules',
      '.claude',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    ignores: nodeFiles,
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: nodeFiles,
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  // Type-aware linting for the security-sensitive server code.
  {
    extends: [...tseslint.configs.recommendedTypeChecked],
    files: ['server/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Handlers and test fakes are deliberately `async` without awaiting so
      // they satisfy Promise-returning interfaces and turn synchronous throws
      // into rejections; removing `async` would change error behaviour.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['server/**/*.test.ts'],
    rules: {
      // `expect(fake.method).toHaveBeenCalled…()` passes vi.fn() mocks
      // unbound by design; the rule cannot tell them from real methods.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
)
