import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { uploadMedia } from '../middleware/upload.js';
import { putMedia } from '../lib/storage.js';

const router = Router();

/** Shape returned to the client for the logged-in user. */
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    // Worker-only
    worker: user.workerProfile
      ? {
          zoneId: user.workerProfile.zoneId,
          zone: user.workerProfile.zone
            ? {
                id: user.workerProfile.zone.id,
                code: user.workerProfile.zone.code,
                name: user.workerProfile.zone.name,
                label: user.workerProfile.zone.label,
              }
            : null,
          approvalStatus: user.workerProfile.approvalStatus,
          rejectionNote: user.workerProfile.rejectionNote,
          dutyStatus: user.workerProfile.dutyStatus,
          availability: user.workerProfile.availability,
          activeTaskCount: user.workerProfile.activeTaskCount,
          tasksCompletedToday: user.workerProfile.tasksCompletedToday,
          tasksCompletedTotal: user.workerProfile.tasksCompletedTotal,
        }
      : null,
    // Officer-only
    zone: user.zoneOwned
      ? {
          id: user.zoneOwned.id,
          code: user.zoneOwned.code,
          name: user.zoneOwned.name,
          label: user.zoneOwned.label,
          colorHex: user.zoneOwned.colorHex,
        }
      : null,
  };
}

const registerSchema = z.object({
  name: z.string().min(2, 'Name is too short'),
  email: z.string().email(),
  phone: z.string().min(10).max(15).optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['RESIDENT', 'WORKER']).default('RESIDENT'),
  // Workers must pick the zone they will serve
  zoneCode: z.coerce.number().int().min(1).max(8).optional(),
});

/**
 * POST /api/auth/register
 *
 * Residents are usable immediately. Workers are created PENDING and cannot
 * receive a single task until the Admin verifies them - that gate lives in
 * `requireApprovedWorker`.
 *
 * Officers and Admins are never self-registered; they are created by an Admin.
 */
router.post(
  '/register',
  uploadMedia.single('idProof'),
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'Invalid registration details', parsed.error.flatten().fieldErrors);
    }
    const { name, email, phone, password, role, zoneCode } = parsed.data;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
    });
    if (existing) throw new ApiError(409, 'An account with that email or phone already exists');

    if (role === 'WORKER' && !zoneCode) {
      throw new ApiError(400, 'Workers must select the zone they will work in');
    }

    const zone =
      role === 'WORKER' ? await prisma.zone.findUnique({ where: { code: zoneCode } }) : null;
    if (role === 'WORKER' && !zone) throw new ApiError(404, `Zone ${zoneCode} does not exist`);

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        passwordHash,
        role,
        ...(role === 'WORKER'
          ? {
              workerProfile: {
                create: {
                  zoneId: zone.id,
                  idProofUrl: req.file ? await putMedia(req.file) : null,
                  approvalStatus: 'PENDING',
                },
              },
            }
          : {}),
      },
      include: { workerProfile: { include: { zone: true } }, zoneOwned: true },
    });

    // Let the admins know there is someone to verify.
    if (role === 'WORKER') {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
      if (admins.length) {
        await prisma.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            title: 'New worker awaiting verification',
            body: `${name} registered for ${zone.name} (${zone.label}).`,
          })),
        });
      }
    }

    res.status(201).json({
      token: signToken(user),
      user: publicUser(user),
      message:
        role === 'WORKER'
          ? 'Registered. An admin must verify your account before you can receive tasks.'
          : 'Registered successfully.',
    });
  }),
);

/** POST /api/auth/login */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Email and password are required');

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      include: { workerProfile: { include: { zone: true } }, zoneOwned: true },
    });

    // Same message either way, so the endpoint cannot be used to discover
    // which email addresses exist.
    if (!user) throw new ApiError(401, 'Incorrect email or password');

    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!ok) throw new ApiError(401, 'Incorrect email or password');
    if (!user.isActive) throw new ApiError(403, 'Your account has been disabled');

    res.json({ token: signToken(user), user: publicUser(user) });
  }),
);

/** GET /api/auth/me - used on app launch to restore the session. */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const unread = await prisma.notification.count({
      where: { userId: req.user.id, readAt: null },
    });
    res.json({ user: publicUser(req.user), unreadNotifications: unread });
  }),
);

export { router as authRouter, publicUser };

