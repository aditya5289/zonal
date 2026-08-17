/**
 * Audit of the allotment logic.
 *
 * Probes the two places where worker/zone assignment could go wrong:
 *   A. re-allotting a complaint that already has a worker
 *   B. an officer allotting a worker who is not theirs
 *
 *   node scripts/allotment-audit.js     (run after a fresh seed)
 */

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';
const PASSWORD = 'password123';

let issues = 0;

const ok = (name, detail = '') =>
  console.log(`  OK    ${name}${detail ? ` — ${detail}` : ''}`);
const bug = (name, detail = '') => {
  issues++;
  console.log(`  BUG   ${name}${detail ? ` — ${detail}` : ''}`);
};

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

const CAMPUS_LAT = 26.7314;
const CAMPUS_LNG = 83.4324;
const STEP = 0.0022;
const RING = [
  [1, 1, 0], [8, 1, 1], [7, 0, 1], [6, -1, 1],
  [5, -1, 0], [4, -1, -1], [3, 0, -1], [2, 1, -1],
];

async function fileAndVerify(resident, admin, zone, landmarkId, label) {
  const f = new FormData();
  f.append('category', 'GARBAGE');
  f.append('description', label);
  f.append('lat', `${zone.centroid.lat}`);
  f.append('lng', `${zone.centroid.lng}`);
  f.append('landmarkId', landmarkId);
  f.append('media', png(), 't.png');
  const c = await api('/complaints', { method: 'POST', token: resident, form: f });
  if (!c.ok) throw new Error(`file: ${c.body.error}`);
  await api(`/admin/complaints/${c.body.complaint.id}/review`, {
    method: 'POST',
    token: admin,
    body: { approve: true },
  });
  return c.body.complaint;
}

const workerState = async (token) => (await api('/worker/status', { token })).body;

async function main() {
  console.log('\nAllotment audit\n');

  const admin = await login('admin@campus.edu');
  const resident = await login('aditya@campus.edu');
  const officer1 = await login('officer1@campus.edu');

  await api('/admin/zones/anchors', {
    method: 'POST',
    token: admin,
    body: {
      anchors: RING.map(([code, dLat, dLng]) => ({
        code,
        lat: CAMPUS_LAT + dLat * STEP,
        lng: CAMPUS_LNG + dLng * STEP,
      })),
      marginM: 400,
    },
  });

  const zones = (await api('/zones')).body.zones;
  const zone1 = zones.find((z) => z.code === 1);
  const landmarkId = (await api('/landmarks', { token: resident })).body.landmarks[0].id;

  // ---------------------------------------------------------------- CASE A
  console.log('A. Re-allotting a complaint that already has a worker');

  const ramesh = await login('ramesh.kumar@campus.edu');
  await api('/worker/duty', { method: 'POST', token: ramesh, body: { dutyStatus: 'ON' } });

  // Re-allotment has to stay INSIDE the zone, so Zone 1 needs a second active
  // worker. Salim ships as PENDING; approve him the way an admin would.
  const workers = (await api('/admin/workers?status=PENDING', { token: admin })).body.workers;
  const salim = workers.find((w) => w.email === 'salim.ansari@campus.edu');
  await api(`/admin/workers/${salim.userId}/verify`, {
    method: 'POST',
    token: admin,
    body: { approve: true },
  });
  const salimToken = await login('salim.ansari@campus.edu');
  await api('/worker/duty', { method: 'POST', token: salimToken, body: { dutyStatus: 'ON' } });

  const a = await fileAndVerify(resident, admin, zone1, landmarkId, 'reallot audit');

  const cand = await api(`/officer/complaints/${a.id}/candidates`, { token: officer1 });
  const first = cand.body.suggested;
  await api(`/officer/complaints/${a.id}/allot`, {
    method: 'POST',
    token: officer1,
    body: { workerUserId: first.userId },
  });

  const firstToken = first.name === 'Ramesh Kumar' ? ramesh : salimToken;
  let s = await workerState(firstToken);
  console.log(`     allotted to ${first.name}: activeTasks=${s.activeTaskCount}, ${s.availability}`);

  // Push it to REOPENED: worker does the job, resident sends it back.
  await api(`/worker/tasks/${a.id}/start`, { method: 'POST', token: firstToken });
  const done = new FormData();
  done.append('media', png(), 'after.png');
  await api(`/worker/tasks/${a.id}/done`, { method: 'POST', token: firstToken, form: done });
  await api(`/complaints/${a.id}/satisfaction`, {
    method: 'POST',
    token: resident,
    body: { satisfied: false, note: 'still dirty' },
  });

  s = await workerState(firstToken);
  console.log(`     after rework requested:  activeTasks=${s.activeTaskCount}, ${s.availability}`);

  // Officer now re-allots to somebody else.
  // Must be a worker in the SAME zone - officers cannot reach into another.
  const others = ((await api('/admin/free-workers', { token: admin })).body.zones.find(
    (z) => z.zone.code === 1,
  )?.workers ?? []).filter((w) => w.userId !== first.userId);

  if (others.length === 0) {
    console.log('     (no second worker free — cannot test re-allotment)');
  } else {
    const second = others[0];
    const re = await api(`/officer/complaints/${a.id}/allot`, {
      method: 'POST',
      token: officer1,
      body: { workerUserId: second.userId },
    });
    console.log(`     re-allotted to ${second.name}: ${re.ok ? 'accepted' : re.body.error}`);

    if (re.ok) {
      s = await workerState(firstToken);
      if (s.activeTaskCount > 0) {
        bug(
          'the previous worker is never released',
          `${first.name} still shows activeTasks=${s.activeTaskCount}, ${s.availability} with no task`,
        );
      } else {
        ok('the previous worker is released on re-allotment');
      }
    }
  }

  // ---------------------------------------------------------------- CASE B
  console.log('\nB. An officer allotting a worker from another zone');

  const b = await fileAndVerify(resident, admin, zone1, landmarkId, 'cross-zone audit');

  // A worker who belongs to Zone 6, not Zone 1.
  const pooja = await login('pooja.kumari@campus.edu');
  await api('/worker/duty', { method: 'POST', token: pooja, body: { dutyStatus: 'ON' } });

  const zone6Free = (await api('/admin/free-workers', { token: admin })).body.zones.find(
    (z) => z.zone.code === 6,
  );
  const outsider = zone6Free?.workers?.[0];

  if (!outsider) {
    console.log('     (no free Zone 6 worker — skipped)');
  } else {
    const direct = await api(`/officer/complaints/${b.id}/allot`, {
      method: 'POST',
      token: officer1,
      body: { workerUserId: outsider.userId },
    });

    if (direct.ok) {
      bug(
        'an officer can allot another zone\'s worker with no help request',
        `Zone 1 officer took ${outsider.name} from Zone 6 directly`,
      );
    } else {
      ok('allotting outside your own zone is refused', direct.body.error);
    }
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`  ${issues} issue(s) found`);
  console.log(`${'-'.repeat(60)}\n`);
}

main().catch((e) => {
  console.error('crashed:', e.message);
  process.exit(1);
});
