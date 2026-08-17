/**
 * Production entrypoint.
 *
 * Replaces `prisma migrate deploy && node src/server.js`, which fails silently:
 * if the migration cannot reach the database, the whole command dies before
 * the app prints anything, and the platform reports only "healthcheck failed".
 *
 * This does the same work but narrates it, so a failed deploy says which step
 * broke and why.
 */

import { spawn } from 'node:child_process';

const line = (s = '') => console.log(s);
const step = (n, what) => line(`\n[${n}/3] ${what}`);

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      line(`  could not run ${command}: ${err.message}`);
      resolve(1);
    });
  });
}

line('\n=================================================');
line(' Smart Clean Campus API - starting');
line('=================================================');

// --- 1. what are we configured with? ---------------------------------------
step(1, 'Configuration');

const dbUrl = process.env.DATABASE_URL ?? '';
const dbHost = dbUrl.match(/@([^:/]+)/)?.[1] ?? '(not set)';

line(`  NODE_ENV        ${process.env.NODE_ENV ?? '(unset)'}`);
line(`  PORT            ${process.env.PORT ?? '4000 (default)'}`);
line(`  database host   ${dbHost}`);
line(`  storage         ${process.env.STORAGE_DRIVER ?? 'local'}`);
line(`  public url      ${process.env.PUBLIC_URL || '(not set)'}`);
line(`  cors origins    ${process.env.CORS_ORIGINS || '(not set)'}`);
line(`  jwt secret      ${process.env.JWT_SECRET ? `set, ${process.env.JWT_SECRET.length} chars` : 'NOT SET'}`);

const missing = ['DATABASE_URL', 'JWT_SECRET', 'PUBLIC_URL', 'CORS_ORIGINS'].filter(
  (k) => !process.env[k],
);

if (missing.length) {
  line(`\n  MISSING VARIABLES: ${missing.join(', ')}`);
  line('  Add them in the platform dashboard, then redeploy.\n');
  process.exit(1);
}

// --- 2. can we actually reach the database? --------------------------------
step(2, 'Database');

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

try {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timed out after 25s')), 25_000),
  );
  await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
  line('  reachable');
  await prisma.$disconnect();
} catch (err) {
  await prisma.$disconnect().catch(() => {});
  line(`  UNREACHABLE - ${err.message.split('\n')[0]}`);
  line('');

  if (dbHost.startsWith('db.') && dbHost.endsWith('.supabase.co')) {
    line('  This is a Supabase DIRECT connection, which is IPv6-only.');
    line('  On Railway: Settings > Networking > enable "Outbound IPv6".');
    line('  Otherwise use a database this host can reach.');
  } else {
    line('  Check DATABASE_URL, and that the database allows this host.');
  }
  line('');
  process.exit(1);
}

// --- 3. schema, then serve -------------------------------------------------
step(3, 'Migrations');

const migrateCode = await run('npx', ['prisma', 'migrate', 'deploy']);
if (migrateCode !== 0) {
  line('\n  Migration failed - see the Prisma output above.');
  line('  The server will not start against an unmigrated database.\n');
  process.exit(1);
}

line('\n-------------------------------------------------');
line(' Handing over to the server');
line('-------------------------------------------------\n');

await import('../src/server.js');
