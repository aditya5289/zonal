/**
 * Reproduces the "Verify does nothing" report against the live API, for both
 * the admin panel and the zone officer panel.
 *
 *   node scripts/verify-flow-check.js
 */

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';
const PASSWORD = 'password123';

const log = (label, value) => console.log(`  ${label.padEnd(46)} ${value}`);

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

async function file(token, zone, landmarkId, label) {
  const f = new FormData();
  f.append('category', 'GARBAGE');
  f.append('description', label);
  f.append('lat', `${zone.centroid.lat}`);
  f.append('lng', `${zone.centroid.lng}`);
  f.append('landmarkId', landmarkId);
  f.append('media', png(), 't.png');
  const r = await api('/complaints', { method: 'POST', token, form: f });
  if (!r.ok) throw new Error(`file complaint: ${r.body.error}`);
  return r.body.complaint;
}

async function main() {
  const resident = await login('aditya@campus.edu');
  const officer1 = await login('officer1@campus.edu');
  const admin = await login('admin@campus.edu');

  const zone1 = (await api('/zones')).body.zones.find((z) => z.code === 1);
  const landmarkId = (await api('/landmarks', { token: resident })).body.landmarks[0].id;

  // ---------------------------------------------------------------- officer
  console.log('\nZONE OFFICER PANEL');
  const a = await file(resident, zone1, landmarkId, 'officer verify check');
  log('filed, status', a.status);

  let dash = await api('/officer/dashboard', { token: officer1 });
  let row = (dash.body.actionQueue ?? []).find((c) => c.id === a.id);
  log('appears in officer queue as', row?.status ?? 'MISSING');

  const oVerify = await api(`/officer/complaints/${a.id}/review`, {
    method: 'POST',
    token: officer1,
    body: { approve: true },
  });
  log('verify call', oVerify.ok ? 'OK' : `FAILED ${oVerify.status} ${oVerify.body.error}`);
  log('status in the verify RESPONSE', oVerify.body.complaint?.status ?? '-');

  dash = await api('/officer/dashboard', { token: officer1 });
  row = (dash.body.actionQueue ?? []).find((c) => c.id === a.id);
  log('status when the dashboard is re-fetched', row?.status ?? 'GONE FROM QUEUE');

  const detail = await api(`/complaints/${a.id}`, { token: officer1 });
  log('status read straight from the database', detail.body.complaint?.status ?? '-');

  // ------------------------------------------------------------------ admin
  console.log('\nADMIN PANEL');
  const b = await file(resident, zone1, landmarkId, 'admin verify check');
  log('filed, status', b.status);

  let pending = await api('/admin/complaints/pending', { token: admin });
  log('in admin pending queue', (pending.body.complaints ?? []).some((c) => c.id === b.id));

  const aVerify = await api(`/admin/complaints/${b.id}/review`, {
    method: 'POST',
    token: admin,
    body: { approve: true },
  });
  log('verify call', aVerify.ok ? 'OK' : `FAILED ${aVerify.status} ${aVerify.body.error}`);
  log('status in the verify RESPONSE', aVerify.body.complaint?.status ?? '-');

  pending = await api('/admin/complaints/pending', { token: admin });
  log(
    'still in admin pending queue after verify',
    (pending.body.complaints ?? []).some((c) => c.id === b.id),
  );

  const bDetail = await api(`/complaints/${b.id}`, { token: admin });
  log('status read straight from the database', bDetail.body.complaint?.status ?? '-');

  console.log('');
}

main().catch((e) => {
  console.error('crashed:', e.message);
  process.exit(1);
});
