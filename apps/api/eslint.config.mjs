import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'src/generated/**', 'coverage/**', '*.config.js', 'test/*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Raw SQL must go through tagged templates ($queryRaw`...`), never string concatenation.
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: 'Use the $queryRaw tagged template (parameterized).' },
        { property: '$executeRawUnsafe', message: 'Use the $executeRaw tagged template (parameterized).' },
        // The Prisma client runs as ventidoc_app, which has no access to password hashes.
        { property: 'userCredential', message: 'Password hashes are only accessible through CredentialStore.' },
      ],
    },
  },
);
