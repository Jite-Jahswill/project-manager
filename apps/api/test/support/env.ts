/** Points the app at the isolated test database before any module loads. */
import { config } from 'dotenv';
import { resolve } from 'node:path';

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
process.env.AUTH_RATE_LIMIT_PER_MINUTE = '100000';
