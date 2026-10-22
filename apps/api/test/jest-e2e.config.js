/** Integration tests: real PostgreSQL (TEST_DATABASE_URL) with RLS policies applied. */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  watchman: false,
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  setupFiles: ['<rootDir>/test/support/env.ts'],
  testTimeout: 30000,
};
