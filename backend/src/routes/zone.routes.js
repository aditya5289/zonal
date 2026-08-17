import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { authenticate } from '../middleware/auth.js';
import { detectZone } from '../utils/geo.js';

const router = Router();

/** Plain-language explanation of how the zone was decided. */
function switchNote(resolvedBy, distanceM) {
  switch (resolvedBy) {
    case 'POLYGON':
      return null;
    case 'OVERLAP_SMALLEST':
      return 'This spot sits where two zones overlap. The smaller one is shown — change it if that is wrong.';
    case 'NEAREST_EDGE':
      return `You are ${distanceM}m outside every zone boundary — a road, the park, or just a rough GPS fix. The closest zone is shown; change it if that is wrong.`;
    case 'OUT_OF_BOUNDS':
      return `This is ${distanceM}m from the nearest zone, which looks like it is off campus. Check the location before submitting.`;
    default:
      return null;
  }
}

/**
 * GET /api/zones
 * The 8 zones with their polygons - drives the campus map and the zone picker
 * on the worker registration screen.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const zones = await prisma.zone.findMany({
      orderBy: { code: 'asc' },
      include: {
        officer: { select: { id: true, name: true, phone: true } },
        _count: { select: { workers: true } },
      },
    });

    res.json({
      zones: zones.map((z) => ({
        id: z.id,
        code: z.code,
        name: z.name,
        label: z.label,
        colorHex: z.colorHex,
        polygon: z.polygon,
        centroid: { lat: z.centroidLat, lng: z.centroidLng },
        neighbourCodes: z.neighbourCodes,
        officer: z.officer,
        workerCount: z._count.workers,
      })),
    });
  }),
);

/**
 * GET /api/zones/detect?lat=..&lng=..
 *
 * Called live by the app while the resident is capturing, so they see which
 * zone they are standing in before they submit. If the fix lands outside every
 * polygon (the central park, a road, or just a poor fix) we return the nearest
 * zone and flag it, and the resident can override.
 */
router.get(
  '/detect',
  authenticate,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) throw new ApiError(400, 'A valid lat and lng are required');

    const zones = await prisma.zone.findMany({ orderBy: { code: 'asc' } });
    if (!zones.length) throw new ApiError(500, 'No zones configured - run the seed');

    let result;
    try {
      result = detectZone(parsed.data.lat, parsed.data.lng, zones);
    } catch (err) {
      if (err.code === 'NO_ZONES_CONFIGURED') {
        throw new ApiError(
          503,
          'No zone boundaries have been drawn yet. The admin needs to set up the campus first.',
        );
      }
      throw err;
    }
    const { zone, matchedPolygon, distanceM, resolvedBy, outOfBounds } = result;

    res.json({
      zone: {
        id: zone.id,
        code: zone.code,
        name: zone.name,
        label: zone.label,
        colorHex: zone.colorHex,
      },
      matchedPolygon,
      resolvedBy,
      outOfBounds,
      distanceM: Math.round(distanceM),
      overlappingZoneCodes: result.overlappingZoneCodes,
      note: switchNote(resolvedBy, Math.round(distanceM)),
    });
  }),
);

export { router as zoneRouter };
