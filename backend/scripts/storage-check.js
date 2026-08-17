/**
 * Verifies Supabase Storage end to end: upload, sign, fetch, delete.
 *
 * Runs against the real bucket using the credentials in .env, so a pass means
 * the app will actually be able to store and serve complaint photos.
 *
 *   node scripts/storage-check.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { putMedia, signMediaUrls, removeMedia, storageDriver } from '../src/lib/storage.js';
import { env } from '../src/config/env.js';

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

// A tiny but genuinely valid PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  console.log('\nSupabase Storage check\n');

  console.log(`  driver : ${storageDriver}`);
  console.log(`  url    : ${env.storage.supabaseUrl || '(not set)'}`);
  console.log(`  bucket : ${env.storage.bucket}\n`);

  if (storageDriver !== 'supabase') {
    console.log('  STORAGE_DRIVER is not "supabase" — nothing to check.\n');
    process.exit(0);
  }

  const supabase = createClient(env.storage.supabaseUrl, env.storage.supabaseSecretKey, {
    auth: { persistSession: false },
  });

  // --- can we reach the project at all? -----------------------------------
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    check('credentials work', false, listError.message);
    console.log('\n  The secret key is wrong, or the project URL is.\n');
    process.exit(1);
  }
  check('credentials work', true, `${buckets.length} bucket(s) visible`);

  const bucket = buckets.find((b) => b.name === env.storage.bucket);

  if (!check('the bucket exists', Boolean(bucket), env.storage.bucket)) {
    console.log(`\n  Buckets found: ${buckets.map((b) => b.name).join(', ') || '(none)'}`);
    console.log(`  Create one named exactly "${env.storage.bucket}", or set`);
    console.log('  SUPABASE_BUCKET in .env to whichever name you used.\n');
    process.exit(1);
  }

  // Private matters: these are photographs of identifiable people.
  check(
    'the bucket is private',
    bucket.public === false,
    bucket.public ? 'PUBLIC — anyone with a URL can read complaint photos' : 'not public',
  );

  // --- the round trip -----------------------------------------------------
  const stored = await putMedia({
    buffer: PNG,
    originalname: 'storage-check.png',
    mimetype: 'image/png',
    size: PNG.length,
  });

  check('a file uploads', stored.startsWith('supabase:'), stored);

  const signed = await signMediaUrls([stored]);
  const url = signed.get(stored);
  check('a signed URL is generated', Boolean(url));

  if (url) {
    const res = await fetch(url);
    check('the signed URL actually serves the file', res.ok, `HTTP ${res.status}`);

    const bytes = Buffer.from(await res.arrayBuffer());
    check('the bytes come back intact', bytes.length === PNG.length, `${bytes.length} bytes`);

    // The same path without a signature must NOT be readable.
    const naked = `${env.storage.supabaseUrl}/storage/v1/object/public/${env.storage.bucket}/${stored.slice(9)}`;
    const nakedRes = await fetch(naked);
    check(
      'the file is NOT readable without a signature',
      !nakedRes.ok,
      `HTTP ${nakedRes.status}`,
    );
  }

  await removeMedia(stored);
  const afterDelete = await signMediaUrls([stored]);
  const goneUrl = afterDelete.get(stored);
  const goneRes = goneUrl ? await fetch(goneUrl) : null;
  check('cleanup removes the file', !goneRes || !goneRes.ok, goneRes ? `HTTP ${goneRes.status}` : 'no url');

  console.log(`\n${'-'.repeat(58)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${'-'.repeat(58)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\ncrashed:', e.message, '\n');
  process.exit(1);
});
