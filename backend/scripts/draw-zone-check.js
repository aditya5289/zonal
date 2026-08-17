/**
 * Proves the draw-from-scratch flow: zones start with no boundary, drawing one
 * saves the exact lat/lngs, and complaints resolve against what was drawn.
 *
 *   node scripts/draw-zone-check.js     (run right after a fresh seed)
 */

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';
const PASSWORD = 'password123';

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

async function api(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, body: json };
}

const login = async (email) => {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  if (!r.ok) throw new Error(`login ${email}: ${r.body.error}`);
  return r.body.token;
};

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

// A square drawn around MMMUT, roughly 200m a side.
const C_LAT = 26.7314;
const C_LNG = 83.4324;
const D = 0.0009; // ~100m

async function main() {
  console.log('\nDraw-your-own-zones check\n');

  const admin = await login('admin@campus.edu');
  const resident = await login('aditya@campus.edu');

  console.log('Before anything is drawn');
  const before = await api('/admin/zones', { token: admin });
  const undrawn = (before.body.zones ?? []).filter((z) => !z.hasBoundary);
  check('all 8 zones start with no boundary', undrawn.length === 8, `${undrawn.length}/8 undrawn`);
  check(
    'no placeholder rectangles are shipped',
    (before.body.zones ?? []).every((z) => z.pointCount === 0),
  );

  const landmarkId = (await api('/landmarks', { token: resident })).body.landmarks[0].id;

  const early = new FormData();
  early.append('category', 'GARBAGE');
  early.append('lat', `${C_LAT}`);
  early.append('lng', `${C_LNG}`);
  early.append('landmarkId', landmarkId);
  early.append('media', png(), 't.png');
  const earlyRes = await api('/complaints', { method: 'POST', token: resident, form: early });
  check(
    'filing before setup fails with a clear message',
    earlyRes.status === 503,
    earlyRes.body.error,
  );

  console.log('\nDrawing Zone 1');
  const drawn = [
    [C_LAT + D, C_LNG - D],
    [C_LAT + D, C_LNG + D],
    [C_LAT - D, C_LNG + D],
    [C_LAT - D, C_LNG - D],
  ];

  const saved = await api('/admin/zones/1', {
    method: 'PUT',
    token: admin,
    body: { polygon: drawn },
  });
  check('the drawn boundary saves', saved.ok, saved.body.error ?? '');

  const after = await api('/admin/zones', { token: admin });
  const z1 = (after.body.zones ?? []).find((z) => z.code === 1);
  check('Zone 1 now has a boundary', z1?.hasBoundary === true);
  check('every corner was stored', z1?.pointCount === 4, `${z1?.pointCount} points`);

  // The exact coordinates must survive the round trip.
  const stored = z1.polygon;
  const matches = drawn.every(
    (p, i) =>
      Math.abs(stored[i][0] - p[0]) < 1e-9 && Math.abs(stored[i][1] - p[1]) < 1e-9,
  );
  check('the exact lat/lngs round-trip unchanged', matches, JSON.stringify(stored[0]));
  check(
    'the centroid is computed from what was drawn',
    Math.abs(z1.centroid.lat - C_LAT) < 0.0001 && Math.abs(z1.centroid.lng - C_LNG) < 0.0001,
    `${z1.centroid.lat.toFixed(5)}, ${z1.centroid.lng.toFixed(5)}`,
  );
  check('area matches a ~200m square', z1.areaM2 > 30000 && z1.areaM2 < 50000, `${z1.areaM2} m²`);

  console.log('\nUsing what was drawn');
  const detect = await api(`/zones/detect?lat=${C_LAT}&lng=${C_LNG}`, { token: resident });
  check(
    'a point inside the drawn shape resolves to Zone 1',
    detect.body.zone?.code === 1 && detect.body.matchedPolygon === true,
    `${detect.body.zone?.name} via ${detect.body.resolvedBy}`,
  );

  const f = new FormData();
  f.append('category', 'GARBAGE');
  f.append('lat', `${C_LAT}`);
  f.append('lng', `${C_LNG}`);
  f.append('landmarkId', landmarkId);
  f.append('media', png(), 't.png');
  const filed = await api('/complaints', { method: 'POST', token: resident, form: f });
  check('a complaint can now be filed', filed.ok, filed.body.error ?? '');
  check('it lands in the drawn zone', filed.body.complaint?.zone?.code === 1);

  console.log('\nSecond zone, and the neighbour ordering');
  const drawn2 = [
    [C_LAT + D, C_LNG + D + 0.0002],
    [C_LAT + D, C_LNG + 3 * D],
    [C_LAT - D, C_LNG + 3 * D],
    [C_LAT - D, C_LNG + D + 0.0002],
  ];
  const saved2 = await api('/admin/zones/2', {
    method: 'PUT',
    token: admin,
    body: { polygon: drawn2 },
  });
  check('a second zone draws beside the first', saved2.ok, saved2.body.error ?? '');
  check(
    'neighbour ordering rebuilds on save',
    (saved2.body.zone?.neighbourCodes?.length ?? 0) === 7,
  );

  const coverage = await api('/admin/zones/coverage?steps=20', { token: admin });
  check(
    'coverage names the zones still undrawn',
    (coverage.body.undrawn ?? []).length === 6,
    `${(coverage.body.undrawn ?? []).length} still to draw`,
  );

  console.log(`\n${'-'.repeat(58)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${'-'.repeat(58)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('crashed:', e.message);
  process.exit(1);
});
