/**
 * Emergency broadcast verification.
 *
 * Files a real emergency, then signs in as one account of every role and
 * checks the alert actually arrived. Counting rows in the database would not
 * prove much - this reads it back the way each app would.
 *
 *   node scripts/emergency-test.js      (run against a freshly seeded db)
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
  const res = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.body.error}`);
  return res.body.token;
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

/** Does this account have an alert for the given complaint? */
async function hasAlert(token, complaintId) {
  const res = await api('/notifications', { token });
  return (res.body.notifications ?? []).some(
    (n) => n.complaintId === complaintId && /emergency/i.test(n.title ?? ''),
  );
}

async function main() {
  console.log('\nEmergency broadcast verification');
  console.log(`${BASE}\n`);

  const reporter = await login('aditya@campus.edu');

  // Every role reads its own inbox, so grab tokens before the alert goes out.
  const otherResident = await login('neha@campus.edu');
  const thirdResident = await login('karan@campus.edu');
  const zoneOfficer = await login('officer5@campus.edu');
  const distantOfficer = await login('officer2@campus.edu');
  const admin = await login('admin@campus.edu');

  // A worker who is ON duty, and one who is OFF.
  const onDutyWorker = await login('suresh.pal@campus.edu');
  await api('/worker/duty', { method: 'POST', token: onDutyWorker, body: { dutyStatus: 'ON' } });

  const offDutyWorker = await login('dinesh.rawat@campus.edu');
  await api('/worker/duty', { method: 'POST', token: offDutyWorker, body: { dutyStatus: 'OFF' } });

  // Zones ship undrawn, so set the campus up first - the same eight pins an
  // admin would drop.
  const CAMPUS_LAT = 26.7314;
  const CAMPUS_LNG = 83.4324;
  const STEP = 0.0022;
  const RING = [
    [1, 1, 0], [8, 1, 1], [7, 0, 1], [6, -1, 1],
    [5, -1, 0], [4, -1, -1], [3, 0, -1], [2, 1, -1],
  ];
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
  const zone5 = zones.find((z) => z.code === 5);

  // The landmark is compulsory on every complaint, emergencies included.
  const places = (await api('/landmarks', { token: reporter })).body.landmarks ?? [];
  const landmarkId = places.find((l) => l.name === 'Residency Area')?.id ?? places[0]?.id;

  console.log('Filing the emergency');
  const form = new FormData();
  form.append('category', 'WATER_LOGGING');
  form.append('description', 'Sewage overflow near the faculty block');
  form.append('lat', `${zone5.centroid.lat}`);
  form.append('lng', `${zone5.centroid.lng}`);
  form.append('landmarkId', landmarkId);
  form.append('landmarkNote', 'Behind the faculty block');
  form.append('isEmergency', 'true');
  form.append('media', png(), 'emergency.png');

  const created = await api('/complaints', { method: 'POST', token: reporter, form });
  if (!check('emergency filed', created.ok, created.body.error ?? '')) process.exit(1);

  const c = created.body.complaint;
  console.log(`  ${created.body.message}\n`);

  console.log('Routing');
  check('flagged as emergency', c.isEmergency === true);
  check('skipped admin verification', c.status === 'ALLOTTED_TO_OFFICER', c.status);
  check('priority raised to HIGH', c.priority === 'HIGH', c.priority);

  console.log('\nWho received the alert');
  check('the zone officer', await hasAlert(zoneOfficer, c.id));
  check('an officer in a DIFFERENT zone', await hasAlert(distantOfficer, c.id));
  check('an on-duty worker', await hasAlert(onDutyWorker, c.id));
  check('the campus admin', await hasAlert(admin, c.id));
  check('another resident', await hasAlert(otherResident, c.id));
  check('a third resident', await hasAlert(thirdResident, c.id));

  console.log('\nWho did NOT (correctly)');
  check(
    'an off-duty worker is left alone',
    !(await hasAlert(offDutyWorker, c.id)),
    'they cannot act on it',
  );
  check(
    'the reporter is not alerted about their own report',
    !(await hasAlert(reporter, c.id)),
  );

  console.log('\nWhat residents are told');
  const residentInbox = await api('/notifications', { token: otherResident });
  const alert = (residentInbox.body.notifications ?? []).find((n) => n.complaintId === c.id);
  check('residents get a safety warning, not a work order', /avoid the area/i.test(alert?.body ?? ''), alert?.body);

  console.log('\nActing on it');
  const dash = await api('/officer/dashboard', { token: distantOfficer });
  const queue = dash.body.actionQueue ?? [];
  check('it appears in a distant officer’s queue', queue.some((q) => q.id === c.id));
  check('it is sorted to the top', queue[0]?.id === c.id, queue[0]?.ref);

  const candidates = await api(`/officer/complaints/${c.id}/candidates`, { token: distantOfficer });
  check(
    'that officer is offered their OWN workers',
    candidates.body.suggested != null,
    candidates.body.suggested?.name,
  );

  const allot = await api(`/officer/complaints/${c.id}/allot`, {
    method: 'POST',
    token: distantOfficer,
    body: { workerUserId: candidates.body.suggested.userId },
  });
  check('any officer can respond', allot.ok, allot.body.error ?? '');
  check(
    'the assigned worker is told directly',
    await hasAlert(distantOfficer, c.id),
  );

  console.log(`\n${'-'.repeat(58)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${'-'.repeat(58)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\nCrashed:', e.message);
  process.exit(1);
});
