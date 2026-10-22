/** Points the app at the isolated test database before any module loads. */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { DEFAULT_POLICIES } from '../../src/abuse/policies';

export const HIGH_LIMITS = Object.keys(DEFAULT_POLICIES).map((p) => `${p}=100000/1m`).join(',');

config({ path: resolve(__dirname, '../../.env'), quiet: true });

const testDb = process.env.TEST_DATABASE_URL;
const testMigrationDb = process.env.TEST_MIGRATION_DATABASE_URL;
const testAuthDb = process.env.TEST_AUTH_DATABASE_URL;
if (!testAuthDb || !new URL(testAuthDb).pathname.endsWith('_test')) throw new Error('TEST_AUTH_DATABASE_URL must point at a *_test database');
if (!testDb || !testMigrationDb) throw new Error('TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL must be set');
if (!new URL(testDb).pathname.endsWith('_test') || !new URL(testMigrationDb).pathname.endsWith('_test')) {
  // Tests truncate every table: refuse to run against anything that is not a *_test database.
  throw new Error('Refusing to run integration tests against a database whose name does not end in _test');
}
process.env.DATABASE_URL = testDb;
process.env.AUTH_DATABASE_URL = testAuthDb;
process.env.MIGRATION_DATABASE_URL = testMigrationDb;
process.env.NODE_ENV = 'test';
process.env.MAIL_TRANSPORT = 'capture';
const testRedis = process.env.TEST_REDIS_URL;
if (!testRedis || !/\/\d+$/.test(new URL(testRedis).pathname) || new URL(testRedis).pathname === '/0') {
  throw new Error('TEST_REDIS_URL must select a non-zero logical database (e.g. .../1)');
}
process.env.REDIS_URL = testRedis;
// Suites not about rate limiting run with very high limits; abuse suites set realistic ones.
process.env.RATE_LIMIT_OVERRIDES = HIGH_LIMITS;
delete process.env.TRUSTED_PROXIES;
