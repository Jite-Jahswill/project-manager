import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Migrations always run as the schema-owning migrator role, never as the app role.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: env('MIGRATION_DATABASE_URL'),
  },
});
