import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from './error.js';

const UPLOAD_ROOT = path.resolve(process.cwd(), env.uploadDir);
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const MIME_TO_TYPE = {
  'image/jpeg': 'PHOTO',
  'image/jpg': 'PHOTO',
  'image/png': 'PHOTO',
  'image/webp': 'PHOTO',
  'image/heic': 'PHOTO',
  'video/mp4': 'VIDEO',
  'video/quicktime': 'VIDEO',
  'video/webm': 'VIDEO',
  'audio/mpeg': 'AUDIO',
  'audio/mp4': 'AUDIO',
  'audio/aac': 'AUDIO',
  'audio/wav': 'AUDIO',
  'audio/webm': 'AUDIO',
  'audio/x-m4a': 'AUDIO',
};

/**
 * Extension fallback.
 *
 * Clients do not always send a useful Content-Type - a plain multipart upload
 * defaults to `application/octet-stream`, which says nothing about whether the
 * file is a photo or a voice note. Rather than reject those, fall back to the
 * filename so a correct upload is never turned away over a missing header.
 */
const EXT_TO_TYPE = {
  '.jpg': 'PHOTO',
  '.jpeg': 'PHOTO',
  '.png': 'PHOTO',
  '.webp': 'PHOTO',
  '.heic': 'PHOTO',
  '.mp4': 'VIDEO',
  '.mov': 'VIDEO',
  '.webm': 'VIDEO',
  '.m4a': 'AUDIO',
  '.aac': 'AUDIO',
  '.wav': 'AUDIO',
  '.mp3': 'AUDIO',
};

export const mediaTypeFor = (mimeType, originalName = '') =>
  MIME_TO_TYPE[mimeType] ?? EXT_TO_TYPE[path.extname(originalName).toLowerCase()] ?? null;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

// Multer enforces a single ceiling, so we take the largest allowed type here
// and check the per-type limit ourselves once we know what was uploaded.
const HARD_LIMIT_MB = Math.max(env.maxPhotoMb, env.maxVideoMb, env.maxAudioMb);

export const uploadMedia = multer({
  storage,
  limits: { fileSize: HARD_LIMIT_MB * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!mediaTypeFor(file.mimetype, file.originalname)) {
      return cb(
        new ApiError(
          400,
          `Unsupported file type: ${file.mimetype} (${file.originalname}). ` +
            'Attach a photo, video or voice recording.',
        ),
      );
    }
    cb(null, true);
  },
});

/** Per-type size ceilings, checked after multer has written the file. */
export function assertWithinTypeLimit(file) {
  const type = mediaTypeFor(file.mimetype, file.originalname);
  const capMb =
    type === 'PHOTO' ? env.maxPhotoMb : type === 'VIDEO' ? env.maxVideoMb : env.maxAudioMb;

  if (file.size > capMb * 1024 * 1024) {
    fs.unlink(file.path, () => {});
    throw new ApiError(400, `${type} files must be under ${capMb} MB`);
  }
  return type;
}

/** Duration ceilings - the client reports these alongside the upload. */
export function assertWithinDurationLimit(type, durationSec) {
  if (durationSec == null) return;
  const cap = type === 'VIDEO' ? env.maxVideoSeconds : type === 'AUDIO' ? env.maxAudioSeconds : null;
  if (cap && durationSec > cap) {
    throw new ApiError(400, `${type} must be ${cap} seconds or shorter`);
  }
}

export const publicUrlFor = (filename) => `/uploads/${filename}`;
