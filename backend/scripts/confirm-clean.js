/**
 * Confirms the database is in the state a demo should start from.
 *
 * Runs at the end of `npm run test:all`, because the test suites set up a
 * campus as part of testing and would otherwise leave zones drawn - which
 * looks exactly like the app shipping placeholder shapes.
 *
 *   npm run demo:reset
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const zones = await prisma.zone.findMany({ orderBy: { code: 'asc' } });
  const complaints = await prisma.complaint.count();
  const landmarks = await prisma.landmark.count();

  const drawn = zones.filter((z) => Array.isArray(z.polygon) && z.polygon.length >= 3);

  console.log('\nDemo state');
  console.log(`  zones          ${zones.length}  (${drawn.length} drawn, ${zones.length - drawn.length} awaiting the admin)`);
  console.log(`  landmarks      ${landmarks}`);
  console.log(`  complaints     ${complaints}`);

  if (drawn.length > 0) {
    console.log('\n  WARNING: some zones already have boundaries.');
    console.log('  Run `npm run db:seed` to clear them before demoing.\n');
    process.exit(1);
  }

  console.log('\n  Ready. Sign in as admin@campus.edu and draw the zones.\n');
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
