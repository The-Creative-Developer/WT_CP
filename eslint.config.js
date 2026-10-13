import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist',
      '**/coverage',
      '**/node_modules',
      'docs/**',
      // Claude Code's local files, including other sessions' git worktrees (full copies of the repo).
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['server/**/*.ts', 'runner/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.mjs', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // [CONCEPT: Accessibility Linting] Catches missing alt text, invalid ARIA and non-interactive click handlers at build time.
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
