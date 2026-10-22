/**
 * Usage: pnpm api bootstrap:super-admin --email owner@example.com --confirm
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { bootstrapSuperAdmin } from '../platform/bootstrap';

async function main() {
  const args = process.argv.slice(2);
  const email = args[args.indexOf('--email') + 1];
  if (!args.includes('--email') || !email || !args.includes('--confirm')) {
    console.error('Usage: bootstrap-super-admin --email <verified user email> --confirm');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const { userId } = await bootstrapSuperAdmin(prisma, email);
    console.log(`Granted Super administrator to user ${userId}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
