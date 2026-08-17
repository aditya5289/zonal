/**
 * Media storage.
 *
 * Two backends behind one interface:
 *
 *   local     - writes to disk. Fine for development, and fine on a single
 *               server with a real disk.
 *   supabase  - writes to Supabase Storage.
 *
 * Supabase is the better answer for anything containerised. Platforms like
 * Railway give each deploy a fresh filesystem, so disk-backed uploads are
 * silently deleted on every push - the complaint rows survive and the
 * evidence does not. Object storage has no such trapdoor, and gets backups
 * and CDN delivery for free.
 *
 * The bucket is PRIVATE. Complaint photographs show identifiable people at a
 * known place and time; they are read through short-lived signed URLs, never
 * a public link.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

const useSupabase = env.storage.driver === 'supabase';

const supabase = useSupabase
  ? createClient(env.storage.supabaseUrl, env.storage.supabaseSecretKey, {
      auth: { persistSession: false },
    })
  : null;

const LOCAL_ROOT = path.resolve(process.cwd(), env.uploadDir);
if (!useSupabase) fs.mkdirSync(LOCAL_ROOT, { recursive: true });

/** Random, unguessable object name. Never derived from user input. */
function objectName(originalName) {
  const ext = path.extname(originalName ?? '').toLowerCase().slice(0, 10);
  const day = new Date().toISOString().slice(0, 10);
  return `${day}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

/**
 * Store one uploaded file.
 *
 * @param {{buffer?:Buffer, path?:string, originalname:string, mimetype:string}} file
 * @returns {Promise<string>} the key to persist on the Media row
 */
export async function putMedia(file) {
  const key = objectName(file.originalname);

  if (!useSupabase) {
    const dest = path.join(LOCAL_ROOT, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (file.buffer) fs.writeFileSync(dest, file.buffer);
    else fs.copyFileSync(file.path, dest);

    return `/uploads/${key}`;
  }

  const body = file.buffer ?? fs.readFileSync(file.path);

  const { error } = await supabase.storage
    .from(env.storage.bucket)
    .upload(key, body, { contentType: file.mimetype, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  // Stored as a bare key. Signed URLs are minted at read time, because a
  // signed URL expires and must never be what lives in the database.
  return `supabase:${key}`;
}

/** Best-effort delete, used when a request fails after files were written. */
export async function removeMedia(stored) {
  try {
    if (!stored) return;

    if (!stored.startsWith('supabase:')) {
      const rel = stored.replace(/^\/uploads\//, '');
      fs.unlink(path.join(LOCAL_ROOT, rel), () => {});
      return;
    }

    await supabase.storage.from(env.storage.bucket).remove([stored.slice(9)]);
  } catch {
    // A leaked object is untidy; failing the request over it would be worse.
  }
}

/**
 * Turn stored keys into URLs the app can load.
 *
 * Batched on purpose: a list of twenty complaints would otherwise mean twenty
 * round trips to sign twenty URLs.
 *
 * @param {string[]} stored
 * @returns {Promise<Map<string,string>>} stored key -> usable URL
 */
export async function signMediaUrls(stored) {
  const out = new Map();
  const unique = [...new Set(stored.filter(Boolean))];
  if (unique.length === 0) return out;

  const supabaseKeys = [];

  for (const s of unique) {
    if (s.startsWith('supabase:')) supabaseKeys.push(s);
    else out.set(s, s); // local path, served by the API's own /uploads route
  }

  if (supabaseKeys.length === 0 || !useSupabase) return out;

  const { data, error } = await supabase.storage
    .from(env.storage.bucket)
    .createSignedUrls(
      supabaseKeys.map((s) => s.slice(9)),
      env.storage.signedUrlSeconds,
    );

  if (error) {
    console.error('Failed to sign media URLs:', error.message);
    return out;
  }

  for (const [i, row] of (data ?? []).entries()) {
    if (row?.signedUrl) out.set(supabaseKeys[i], row.signedUrl);
  }

  return out;
}

export const storageDriver = env.storage.driver;
