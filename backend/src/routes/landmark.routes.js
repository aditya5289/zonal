import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

/** Headings for the picker, in the order they should appear. */
const CATEGORY_LABELS = {
  DEPARTMENT: 'Departments & academic',
  BOYS_HOSTEL: 'Boys hostels',
  GIRLS_HOSTEL: 'Girls hostels',
  FACILITY: 'Facilities',
  RESIDENCE: 'Residences',
};

const CATEGORY_ORDER = [
  'DEPARTMENT',
  'BOYS_HOSTEL',
  'GIRLS_HOSTEL',
  'FACILITY',
  'RESIDENCE',
];

/**
 * GET /api/landmarks
 * The place picker, grouped by category so a list of twenty-odd entries stays
 * readable on a phone.
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (_req, res) => {
    const landmarks = await prisma.landmark.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });

    const groups = CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      landmarks: landmarks
        .filter((l) => l.category === category)
        .map((l) => ({ id: l.id, name: l.name, zoneCode: l.zoneCode })),
    })).filter((g) => g.landmarks.length > 0);

    res.json({
      groups,
      total: landmarks.length,
      landmarks: landmarks.map((l) => ({
        id: l.id,
        name: l.name,
        category: l.category,
        zoneCode: l.zoneCode,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Admin management - so the list can be corrected without a redeploy
// ---------------------------------------------------------------------------

router.use(authenticate, requireRole('ADMIN'));

/** POST /api/landmarks  { name, category, zoneCode? } */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().min(2).max(80),
      category: z.enum(['DEPARTMENT', 'BOYS_HOSTEL', 'GIRLS_HOSTEL', 'FACILITY', 'RESIDENCE']),
      zoneCode: z.coerce.number().int().min(1).max(8).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'Invalid landmark', parsed.error.flatten().fieldErrors);
    }

    const clash = await prisma.landmark.findUnique({ where: { name: parsed.data.name } });
    if (clash) throw new ApiError(409, `"${parsed.data.name}" already exists`);

    const max = await prisma.landmark.aggregate({
      where: { category: parsed.data.category },
      _max: { sortOrder: true },
    });

    const landmark = await prisma.landmark.create({
      data: {
        name: parsed.data.name,
        category: parsed.data.category,
        zoneCode: parsed.data.zoneCode ?? null,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });

    res.status(201).json({ landmark, message: `${landmark.name} added.` });
  }),
);

/** PUT /api/landmarks/:id */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().min(2).max(80).optional(),
      category: z
        .enum(['DEPARTMENT', 'BOYS_HOSTEL', 'GIRLS_HOSTEL', 'FACILITY', 'RESIDENCE'])
        .optional(),
      zoneCode: z.coerce.number().int().min(1).max(8).nullable().optional(),
      isActive: z.coerce.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Invalid landmark');

    const existing = await prisma.landmark.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, 'Landmark not found');

    const landmark = await prisma.landmark.update({
      where: { id: req.params.id },
      data: parsed.data,
    });

    res.json({ landmark, message: `${landmark.name} updated.` });
  }),
);

export { router as landmarkRouter };
