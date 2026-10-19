module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'data'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  overrides: [
    {
      files: ['server/**/*.js', 'scripts/**/*.js'],
      env: { node: true, es2020: true }
    }
  ],
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    'react/prop-types': 'off', // 关闭 prop-types 检查（项目未使用）
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['error', { allowEmptyCatch: true }], // 解析兜底大量使用空 catch，属有意行为
  },
}
