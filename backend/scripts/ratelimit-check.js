/**
 * Proves the rate limiting works, rather than assuming the config is right.
 *
 * Run the server with tight limits so the test is fast:
 *
 *   RATE_LIMIT_AUTH_MAX=5 RATE_LIMIT_API_MAX=40 RATE_LIMIT_UPLOAD_MAX=3 npm run start
 *   node scripts/ratelimit-check.js
 */

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';

const AUTH_MAX = Number(process.env.RATE_LIMIT_AUTH_MAX ?? 5);
const UPLOAD_MAX = Number(process.env.RATE_LIMIT_UPLOAD_MAX ?? 3);

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) };
}

const png = () =>
  new Blob(
    [
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    ],
    { type: 'image/png' },
  );

async function main() {
  console.log('\nRate limit check');
  console.log(`  auth max ${AUTH_MAX} · upload max ${UPLOAD_MAX}\n`);

  // Grab a token BEFORE testing the auth limiter - the brute-force test
  // deliberately exhausts that budget, and nothing could sign in afterwards.
  const preLogin = await post('/auth/login', {
    email: 'aditya@campus.edu',
    password: 'password123',
  });
  const residentToken = preLogin.body?.token ?? null;

  // --- login brute force --------------------------------------------------
  console.log('Sign-in attempts');
  let blockedAt = null;
  let sawHeaders = false;

  for (let i = 1; i <= AUTH_MAX + 4; i++) {
    const r = await post('/auth/login', {
      email: 'admin@campus.edu',
      password: 'definitely-wrong',
    });
    // draft-7 sends one combined `RateLimit` header, not RateLimit-Limit etc.
    if (r.headers.get('ratelimit') || r.headers.get('ratelimit-limit')) sawHeaders = true;
    if (r.status === 429) {
      blockedAt = i;
      check('wrong passwords are eventually blocked', true, `429 on attempt ${i}`);
      check(
        'the message tells the user what to do',
        /wait|try again/i.test(r.body.error ?? ''),
        r.body.error,
      );
      break;
    }
  }

  if (blockedAt === null) {
    check('wrong passwords are eventually blocked', false, `still allowed after ${AUTH_MAX + 4}`);
  } else {
    check(
      'it blocks at roughly the configured limit',
      blockedAt <= AUTH_MAX + 2,
      `limit ${AUTH_MAX}, blocked at ${blockedAt}`,
    );
  }

  check('standard RateLimit headers are sent', sawHeaders);

  // A correct password must ALSO be refused once the budget is spent -
  // otherwise the limiter is trivially bypassed by guessing correctly.
  const correct = await post('/auth/login', {
    email: 'admin@campus.edu',
    password: 'password123',
  });
  check(
    'a correct password is refused too while blocked',
    correct.status === 429,
    `got ${correct.status}`,
  );

  console.log('\nUploads');

  if (!residentToken) {
    console.log('  SKIP  no token — could not sign in before the auth test ran');
  } else {
    const token = residentToken;
    const zones = await (await fetch(`${BASE}/zones`)).json();
    const zone = zones.zones?.find((z) => z.polygon?.length >= 3);
    const landmarks = await (
      await fetch(`${BASE}/landmarks`, { headers: { Authorization: `Bearer ${token}` } })
    ).json();

    if (!zone || !landmarks.landmarks?.length) {
      console.log('  SKIP  no drawn zone or landmarks — run `npm run demo:data` first');
    } else {
      let uploadBlockedAt = null;

      for (let i = 1; i <= UPLOAD_MAX + 3; i++) {
        const form = new FormData();
        form.append('category', 'GARBAGE');
        form.append('lat', `${zone.centroid.lat}`);
        form.append('lng', `${zone.centroid.lng}`);
        form.append('landmarkId', landmarks.landmarks[0].id);
        form.append('media', png(), 't.png');

        const res = await fetch(`${BASE}/complaints`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });

        if (res.status === 429) {
          uploadBlockedAt = i;
          break;
        }
      }

      check(
        'repeated uploads are throttled',
        uploadBlockedAt !== null,
        uploadBlockedAt ? `429 on upload ${uploadBlockedAt}` : `still allowed after ${UPLOAD_MAX + 3}`,
      );
    }
  }

  console.log(`\n${'-'.repeat(56)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${'-'.repeat(56)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('crashed:', e.message);
  process.exit(1);
});
