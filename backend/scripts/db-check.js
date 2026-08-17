/**
 * Confirms the app can actually reach its database, and says which
 * connection string worked.
 *
 * Supabase dropped IPv4 for direct connections on the free tier, so
 * `db.<project>.supabase.co` resolves to IPv6 only. On an IPv4-only network
 * that times out in a way that looks exactly like a wrong password - which is
 * why this reports the distinction explicitly.
 *
 *   node scripts/db-check.js
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
const host = url.match(/@([^:/]+)/)?.[1] ?? '(unknown)';

console.log('\nDatabase check\n');
console.log(`  host : ${host}`);
console.log(`  mode : ${host.includes('pooler') ? 'session pooler (IPv4 capable)' : 'direct connection'}\n`);

const prisma = new PrismaClient();

const timeout = setTimeout(() => {
  console.log('  TIMED OUT after 20s.\n');
  console.log('  The host resolves but nothing answers. On Supabase this almost');
  console.log('  always means the direct connection is IPv6-only and this network');
  console.log('  is IPv4. Switch to the Session pooler string:\n');
  console.log('    Dashboard > Project Settings > Database > Connection string');
  console.log('    > Session pooler\n');
  process.exit(1);
}, 20_000);

try {
  const rows = await prisma.$queryRaw`SELECT version() AS v`;
  clearTimeout(timeout);
  console.log(`  CONNECTED — ${rows[0].v.split(' on ')[0]}`);

  const tables = await prisma.$queryRaw`
    SELECT count(*)::int AS n
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  console.log(`  tables in public schema: ${tables[0].n}`);
  console.log(
    tables[0].n === 0
      ? '\n  Empty database — run: npx prisma migrate deploy\n'
      : '\n  Schema already present.\n',
  );
  process.exit(0);
} catch (e) {
  clearTimeout(timeout);
  // Prisma's first line is a generic wrapper; the real cause is further down.
  const msg = e.message;
  console.log('  FAILED\n');
  console.log(
    msg
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n'),
  );
  console.log('');

  if (/password|authentication/i.test(msg)) {
    console.log('  The password is wrong. Reset it:');
    console.log('    Dashboard > Project Settings > Database > Reset database password\n');
  } else if (/ENOTFOUND|ENETUNREACH|EHOSTUNREACH|timeout/i.test(msg)) {
    console.log('  Cannot reach the host. If this is the direct connection, use the');
    console.log('  Session pooler string instead - Supabase direct is IPv6-only.\n');
  }
  process.exit(1);
}
