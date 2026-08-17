/**
 * Tries the ap-southeast-2 pooler hosts with both username forms.
 *
 * Supavisor resolves the tenant from the username, and the accepted form has
 * varied between `postgres.<ref>` and plain `postgres` depending on when the
 * project was created and whether it is session or transaction mode. Rather
 * than guess, try each and report which combination authenticates.
 *
 *   node scripts/try-pooler.js <db-password>
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const PROJECT = process.env.SUPABASE_URL?.match(/https:\/\/([^.]+)\./)?.[1];
const PASSWORD = process.argv[2];

if (!PROJECT || !PASSWORD) {
  console.error('\nUsage: node scripts/try-pooler.js <db-password>\n');
  process.exit(1);
}

const HOSTS = [
  'aws-0-ap-southeast-2.pooler.supabase.com',
  'aws-1-ap-southeast-2.pooler.supabase.com',
];

// 5432 is session mode (what Prisma migrations need), 6543 is transaction mode.
const PORTS = [5432, 6543];
const USERS = [`postgres.${PROJECT}`, 'postgres'];

async function attempt(url) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const r = await prisma.$queryRaw`SELECT current_database() AS db`;
    await prisma.$disconnect();
    return { ok: true, db: r[0].db };
  } catch (e) {
    await prisma.$disconnect().catch(() => {});
    const line =
      e.message
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /FATAL|Can't reach|authentication|password|Tenant|timed out/i.test(l)) ??
      e.message.split('\n')[0];
    return { ok: false, why: line };
  }
}

console.log(`\nTrying ap-southeast-2 poolers for ${PROJECT}\n`);

let win = null;

for (const host of HOSTS) {
  for (const port of PORTS) {
    for (const user of USERS) {
      const url = `postgresql://${user}:${encodeURIComponent(PASSWORD)}@${host}:${port}/postgres`;
      const label = `${host.split('.')[0]}:${port} as ${user}`;
      process.stdout.write(`  ${label.padEnd(58)}`);

      const res = await attempt(url);
      if (res.ok) {
        console.log(`CONNECTED (${res.db})`);
        win = { url, host, port, user };
        break;
      }
      console.log((res.why ?? 'failed').slice(0, 60));
    }
    if (win) break;
  }
  if (win) break;
}

if (!win) {
  console.log('\n  Nothing authenticated.');
  console.log('  If the password was reset recently, use the new one.');
  console.log('  Otherwise copy the exact string from the dashboard Connect panel.\n');
  process.exit(1);
}

console.log('\n  Working connection:\n');
console.log(`    postgresql://${win.user}:<password>@${win.host}:${win.port}/postgres\n`);
process.exit(0);
