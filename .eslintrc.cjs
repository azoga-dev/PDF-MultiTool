/**
 * ESLint конфигурация для Electron + TypeScript проекта
 * 
 * Правила настроены для:
 * - Строгой типизации TypeScript
 * - Безопасности Electron (contextIsolation, nodeIntegration)
 * - Современного JavaScript/TypeScript style guide
 */

module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2020: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json'
  },
  plugins: [
    '@typescript-eslint',
    'prettier'
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended'
  ],
  rules: {
    // TypeScript правила
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/ban-ts-comment': ['warn', {
      'ts-ignore': 'allow-with-description',
      'ts-expect-error': 'allow-with-description'
    }],

    // Общие правила
    'no-console': ['warn', { allow: ['warn', 'error', 'debug'] }],
    'no-debugger': 'warn',
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'warn',
    'prefer-template': 'warn',
    'prefer-arrow-callback': 'warn',

    // Prettier integration
    'prettier/prettier': ['warn', {
      endOfLine: 'auto'
    }]
  },
  overrides: [
    // Правила для main process (Electron)
    {
      files: ['src/main/**/*.ts'],
      rules: {
        'no-console': 'off' // Разрешаем console в main process
      }
    },
    // Правила для preload scripts
    {
      files: ['src/preload/**/*.ts'],
      rules: {
        // Строгая проверка безопасности Electron
        '@typescript-eslint/no-explicit-any': 'error'
      }
    },
    // Правила для renderer process
    {
      files: ['src/renderer*.ts', 'src/logWindowRenderer.ts'],
      env: {
        browser: true,
        node: false
      }
    }
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'dist-electron-builder/',
    'vendor/',
    '*.js',
    '!.eslintrc.cjs'
  ]
};
