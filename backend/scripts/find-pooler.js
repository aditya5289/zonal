/**
 * Finds the Session pooler host for this Supabase project.
 *
 * The pooler hostname encodes the project's region, and there is no way to
 * read that from the API keys. Rather than hunt through a dashboard that
 * keeps moving, this tries the plausible regions and reports which one
 * actually authenticates.
 *
 *   node scripts/find-pooler.js
 */

import 'dotenv/config';
import net from 'node:net';
import { PrismaClient } from '@prisma/client';

const PROJECT = process.env.SUPABASE_URL?.match(/https:\/\/([^.]+)\./)?.[1];
const PASSWORD = process.argv[2] ?? process.env.SUPABASE_DB_PASSWORD;

if (!PROJECT || !PASSWORD) {
  console.error('\nUsage: node scripts/find-pooler.js <db-password>\n');
  process.exit(1);
}

// Ordered by likelihood for a project created in India.
const REGIONS = [
  'ap-south-1',
  'ap-south-2',
  'ap-southeast-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-southeast-2',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'sa-east-1',
  'ca-central-1',
];

const PREFIXES = ['aws-0', 'aws-1'];

/** Is anything listening? Cheap filter before trying a real login. */
function reachable(host, port = 5432, ms = 4000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(ms);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, host);
  });
}

async function authenticates(host) {
  const url =
    `postgresql://postgres.${PROJECT}:${encodeURIComponent(PASSWORD)}` +
    `@${host}:5432/postgres`;

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$disconnect();
    return { ok: true, url };
  } catch (e) {
    await prisma.$disconnect().catch(() => {});
    return { ok: false, error: e.message.split('\n').find((l) => /Can't reach|authentication|password|Tenant|FATAL/i.test(l))?.trim() };
  }
}

console.log(`\nLooking for the pooler host for project ${PROJECT}\n`);

let found = null;

for (const prefix of PREFIXES) {
  for (const region of REGIONS) {
    const host = `${prefix}-${region}.pooler.supabase.com`;
    process.stdout.write(`  ${host.padEnd(45)}`);

    if (!(await reachable(host))) {
      console.log('no route');
      continue;
    }

    const result = await authenticates(host);
    if (result.ok) {
      console.log('CONNECTED');
      found = result;
      break;
    }
    console.log(result.error ? `reachable, rejected (${result.error.slice(0, 50)})` : 'reachable, rejected');
  }
  if (found) break;
}

if (!found) {
  console.log('\n  No pooler host accepted the connection.');
  console.log('  Get the exact string from the dashboard: click Connect at the top');
  console.log('  of the project page, then "Session pooler".\n');
  process.exit(1);
}

console.log('\n  Put this in backend/.env as DATABASE_URL:\n');
console.log(`  ${found.url.replace(encodeURIComponent(PASSWORD), '<password>')}\n`);
process.exit(0);
