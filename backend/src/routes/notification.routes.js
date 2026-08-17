import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

/** GET /api/notifications */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [notifications, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
    ]);

    res.json({ notifications, unread });
  }),
);

/** POST /api/notifications/read-all */
router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ marked: result.count });
  }),
);

/** POST /api/notifications/:id/read */
router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  }),
);

export { router as notificationRouter };
