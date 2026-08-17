/**
 * Sweeps every Supavisor pooler region and reports the exact reply.
 *
 * The distinction matters and the earlier run hid it:
 *
 *   "tenant/user not found"   -> right pooler shape, wrong region
 *   "password authentication" -> RIGHT region, wrong password
 *   "Can't reach"             -> nothing listening
 *
 * An auth error is the win condition: it means the tenant was found.
 *
 *   node scripts/sweep-pooler.js <db-password>
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const PROJECT = process.env.SUPABASE_URL?.match(/https:\/\/([^.]+)\./)?.[1];
const PASSWORD = process.argv[2];

if (!PROJECT || !PASSWORD) {
  console.error('\nUsage: node scripts/sweep-pooler.js <db-password>\n');
  process.exit(1);
}

const REGIONS = [
  'ap-southeast-2', 'ap-south-1', 'ap-southeast-1', 'ap-northeast-1',
  'ap-northeast-2', 'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'sa-east-1', 'ca-central-1',
];

const classify = (msg) => {
  if (/password authentication|authentication failed/i.test(msg)) return 'AUTH';
  if (/ENOTFOUND|ENOIDENTIFIER|tenant/i.test(msg)) return 'no-tenant';
  if (/Can't reach|timed out|ETIMEDOUT/i.test(msg)) return 'unreachable';
  return 'other';
};

async function probe(host) {
  const url = `postgresql://postgres.${PROJECT}:${encodeURIComponent(PASSWORD)}@${host}:5432/postgres`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$disconnect();
    return { kind: 'CONNECTED', url };
  } catch (e) {
    await prisma.$disconnect().catch(() => {});
    const msg = e.message.replace(/\s+/g, ' ');
    return { kind: classify(msg), msg: msg.slice(0, 90) };
  }
}

console.log(`\nSweeping poolers for tenant "${PROJECT}"\n`);

const interesting = [];

for (const prefix of ['aws-1', 'aws-0']) {
  for (const region of REGIONS) {
    const host = `${prefix}-${region}.pooler.supabase.com`;
    const res = await probe(host);

    // Only surface anything that is not the boring "wrong region" answer.
    if (res.kind === 'CONNECTED') {
      console.log(`  ${host}\n    CONNECTED\n`);
      console.log(`  Use: postgresql://postgres.${PROJECT}:<password>@${host}:5432/postgres\n`);
      process.exit(0);
    }
    if (res.kind === 'AUTH') {
      console.log(`  ${host}\n    TENANT FOUND but password rejected — this is the right host\n`);
      interesting.push({ host, kind: res.kind, msg: res.msg });
    } else if (res.kind === 'other') {
      console.log(`  ${host}\n    ${res.msg}\n`);
      interesting.push({ host, kind: res.kind, msg: res.msg });
    }
  }
}

if (interesting.length === 0) {
  console.log('  Every region replied "tenant not found".\n');
  console.log('  That means the pooler has no record of this project, which usually');
  console.log('  means connection pooling is not enabled on it yet:\n');
  console.log('    Dashboard > Settings > Database > Connection pooling\n');
} else {
  console.log('  Candidates above. If one says the password was rejected, that host');
  console.log('  is correct and the password needs resetting.\n');
}
process.exit(1);
