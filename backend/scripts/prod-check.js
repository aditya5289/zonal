/**
 * Confirms a deployed instance is genuinely working, not just answering
 * /api/health.
 *
 *   node scripts/prod-check.js https://your-app.up.railway.app
 */

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
if (!BASE) {
  console.error('\nUsage: node scripts/prod-check.js <https://your-app>\n');
  process.exit(1);
}

let passed = 0;
let failed = 0;

const check = (name, ok, detail = '') => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
};

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, opts);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 120) };
  }
  return { status: res.status, ok: res.ok, headers: res.headers, body };
}

console.log(`\nProduction check — ${BASE}\n`);

// --- is it alive and joined to a database? ---------------------------------
const health = await api('/health');
check('API responds', health.ok, `status=${health.body.status}`);
check('database connected', health.body.db === 'up');
check('running in production mode', health.body.env === 'production', health.body.env);

// Which commit answered? 'unknown' means the running code predates this field,
// which is itself the answer: the platform is serving a stale deploy.
console.log(`        deployed commit: ${health.body.commit ?? 'not reported (old build)'}`);

// --- has the schema been created? ------------------------------------------
const zones = await api('/zones');
check('schema exists (zones table readable)', zones.ok, zones.body.error ?? '');
check(
  '8 zones present',
  (zones.body.zones?.length ?? 0) === 8,
  `${zones.body.zones?.length ?? 0} found`,
);

const undrawn = (zones.body.zones ?? []).filter(
  (z) => !Array.isArray(z.polygon) || z.polygon.length < 3,
).length;
check(
  'zones start undrawn, awaiting the admin',
  undrawn === 8,
  `${undrawn}/8 undrawn`,
);

// --- protected routes are actually protected -------------------------------
const noAuth = await api('/complaints/mine');
check('unauthenticated requests are refused', noAuth.status === 401, `HTTP ${noAuth.status}`);

const uploads = await fetch(`${BASE}/uploads/anything.png`);
check(
  'uploads are not publicly served',
  uploads.status === 401 || uploads.status === 404,
  `HTTP ${uploads.status}`,
);

// --- security headers and rate limiting ------------------------------------
check(
  'security headers present (helmet)',
  Boolean(health.headers.get('x-content-type-options')),
  health.headers.get('x-content-type-options') ?? 'missing',
);
check(
  'rate limiting active',
  Boolean(health.headers.get('ratelimit') || health.headers.get('ratelimit-policy')),
  health.headers.get('ratelimit-policy') ?? 'no header',
);
check('served over HTTPS', BASE.startsWith('https://'));

// --- is it seeded yet? -----------------------------------------------------
const login = await api('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }),
});
check(
  'auth endpoint works',
  login.status === 401,
  login.status === 401 ? 'rejects bad credentials' : `HTTP ${login.status}`,
);

const landmarks = await api('/landmarks');
const seeded = landmarks.status === 401; // needs auth, so it exists
check('landmark endpoint mounted', seeded || landmarks.ok);

console.log(`\n${'-'.repeat(56)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'-'.repeat(56)}\n`);

if (failed === 0) {
  console.log('  Next: create the admin from the Railway shell —');
  console.log("    ADMIN_EMAIL=... ADMIN_PASSWORD='...' npm run seed:prod\n");
}
process.exit(failed > 0 ? 1 : 0);
