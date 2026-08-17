import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { transition, notify, notifyMany } from '../services/workflow.js';
import { routeToZoneOfficer, allotWorker, findFreeWorkers } from '../services/allocation.js';
import {
  complaintInclude,
  serializeComplaint,
  loadComplaintForResponse,
} from '../utils/serialize.js';

const router = Router();

router.use(authenticate, requireRole('ADMIN'));

/** GET /api/admin/dashboard - the two queues the admin must clear, plus totals. */
router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [pendingWorkers, pendingComplaints, escalated, byStatus, zones] = await Promise.all([
      prisma.workerProfile.count({ where: { approvalStatus: 'PENDING' } }),
      prisma.complaint.count({ where: { status: 'UNDER_REVIEW' } }),
      prisma.complaint.count({ where: { status: 'ESCALATED' } }),
      prisma.complaint.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.zone.findMany({ orderBy: { code: 'asc' }, include: { officer: true } }),
    ]);

    const zoneStats = await Promise.all(
      zones.map(async (z) => {
        const [open, closed, free, total] = await Promise.all([
          prisma.complaint.count({
            where: { zoneId: z.id, status: { notIn: ['CLOSED', 'AUTO_CLOSED', 'REJECTED_INVALID'] } },
          }),
          prisma.complaint.count({ where: { zoneId: z.id, status: { in: ['CLOSED', 'AUTO_CLOSED'] } } }),
          (await findFreeWorkers(z.id)).length,
          prisma.workerProfile.count({ where: { zoneId: z.id, approvalStatus: 'ACTIVE' } }),
        ]);
        return {
          code: z.code,
          name: z.name,
          label: z.label,
          colorHex: z.colorHex,
          officer: z.officer ? { id: z.officer.id, name: z.officer.name } : null,
          openComplaints: open,
          closedComplaints: closed,
          workersFree: free,
          workersTotal: total,
        };
      }),
    );

    res.json({
      queues: { pendingWorkers, pendingComplaints, escalated },
      statusCounts: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      zones: zoneStats,
    });
  }),
);

// ---------------------------------------------------------------------------
// Worker verification
// ---------------------------------------------------------------------------

/** GET /api/admin/workers?status=PENDING */
router.get(
  '/workers',
  asyncHandler(async (req, res) => {
    const status = req.query.status ?? 'PENDING';

    const workers = await prisma.workerProfile.findMany({
      where: { approvalStatus: status },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, createdAt: true } },
        zone: { select: { code: true, name: true, label: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      workers: workers.map((w) => ({
        userId: w.userId,
        name: w.user.name,
        email: w.user.email,
        phone: w.user.phone,
        registeredAt: w.user.createdAt,
        zone: w.zone,
        idProofUrl: w.idProofUrl,
        approvalStatus: w.approvalStatus,
        dutyStatus: w.dutyStatus,
        availability: w.availability,
        tasksCompletedTotal: w.tasksCompletedTotal,
      })),
    });
  }),
);

/**
 * POST /api/admin/workers/:userId/verify  { approve: bool, note? }
 * This is the onboarding gate - until it passes, the worker cannot be
 * allotted a single task.
 */
router.post(
  '/workers/:userId/verify',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      approve: z.coerce.boolean(),
      note: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, '`approve` must be true or false');

    const profile = await prisma.workerProfile.findUnique({
      where: { userId: req.params.userId },
      include: { user: true, zone: true },
    });
    if (!profile) throw new ApiError(404, 'Worker not found');
    if (profile.approvalStatus === 'ACTIVE' && parsed.data.approve) {
      throw new ApiError(409, 'That worker is already verified');
    }

    const updated = await prisma.workerProfile.update({
      where: { userId: req.params.userId },
      data: {
        approvalStatus: parsed.data.approve ? 'ACTIVE' : 'REJECTED',
        approvedAt: parsed.data.approve ? new Date() : null,
        rejectionNote: parsed.data.approve ? null : (parsed.data.note ?? 'Not approved'),
        dutyStatus: 'OFF',
      },
    });

    await notify({
      userId: profile.userId,
      title: parsed.data.approve ? 'You have been verified' : 'Registration not approved',
      body: parsed.data.approve
        ? `You are now an active worker for ${profile.zone.name}. Go on duty to start receiving tasks.`
        : (parsed.data.note ?? 'Your worker registration was not approved. Contact the campus admin.'),
    });

    // The zone officer should know their roster changed.
    const zone = await prisma.zone.findUnique({ where: { id: profile.zoneId } });
    if (parsed.data.approve && zone?.officerId) {
      await notify({
        userId: zone.officerId,
        title: 'New worker added to your zone',
        body: `${profile.user.name} has been verified for ${zone.name}.`,
      });
    }

    res.json({
      approvalStatus: updated.approvalStatus,
      message: parsed.data.approve
        ? `${profile.user.name} is now active in ${profile.zone.name}.`
        : `${profile.user.name} was rejected.`,
    });
  }),
);

// ---------------------------------------------------------------------------
// Complaint verification
// ---------------------------------------------------------------------------

/** GET /api/admin/complaints/pending - the verification queue. */
router.get(
  '/complaints/pending',
  asyncHandler(async (_req, res) => {
    const complaints = await prisma.complaint.findMany({
      where: { status: 'UNDER_REVIEW' },
      include: complaintInclude,
      orderBy: { submittedAt: 'asc' },
    });
    res.json({ complaints: complaints.map(serializeComplaint) });
  }),
);

/**
 * POST /api/admin/complaints/:id/review  { approve: bool, reason? }
 *
 * On approval the engine immediately auto-routes the complaint to the officer
 * of the zone it was reported in - no human picks the officer.
 */
router.post(
  '/complaints/:id/review',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      approve: z.coerce.boolean(),
      reason: z.string().max(500).optional(),
      /// Set when the admin corrects a boundary case before routing it.
      zoneCode: z.coerce.number().int().min(1).max(8).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, '`approve` must be true or false');

    const complaint = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: { zone: true },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');
    if (complaint.status !== 'UNDER_REVIEW') {
      throw new ApiError(409, `This complaint is ${complaint.status}, not awaiting review`);
    }

    if (!parsed.data.approve) {
      await transition({
        complaintId: complaint.id,
        toStatus: 'REJECTED_INVALID',
        actor: req.user,
        note: parsed.data.reason ?? 'Rejected by admin',
        data: { rejectionReason: parsed.data.reason ?? 'Rejected by admin' },
      });
      const rejected = await loadComplaintForResponse(prisma, complaint.id);

      await notify({
        userId: complaint.reporterId,
        complaintId: complaint.id,
        title: 'Complaint not accepted',
        body: `${complaint.ref}: ${parsed.data.reason ?? 'the admin could not accept this complaint.'}`,
      });

      return res.json({
        complaint: serializeComplaint(rejected),
        message: 'Complaint rejected.',
      });
    }

    // The admin may correct the zone before it is routed - this is where a
    // boundary case gets a human decision, rather than silently landing on the
    // wrong officer's screen.
    let targetZone = complaint.zone;
    if (parsed.data.zoneCode && parsed.data.zoneCode !== complaint.zone.code) {
      const corrected = await prisma.zone.findUnique({ where: { code: parsed.data.zoneCode } });
      if (!corrected) throw new ApiError(404, `Zone ${parsed.data.zoneCode} not found`);
      targetZone = corrected;

      await prisma.statusLog.create({
        data: {
          complaintId: complaint.id,
          fromStatus: complaint.status,
          toStatus: complaint.status,
          actorId: req.user.id,
          note: `Zone corrected by admin: ${complaint.zone.name} -> ${corrected.name}`,
        },
      });
    }

    await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        approvedByAdminId: req.user.id,
        approvedAt: new Date(),
        ...(targetZone.id !== complaint.zoneId
          ? { zoneId: targetZone.id, zoneResolvedBy: 'ADMIN_OVERRIDE', zoneDistanceM: null }
          : {}),
      },
    });

    const routed = await routeToZoneOfficer(
      { ...complaint, zoneId: targetZone.id },
      { actor: req.user },
    );

    await notify({
      userId: complaint.reporterId,
      complaintId: complaint.id,
      title: 'Complaint verified',
      body: `${complaint.ref} has been verified and sent to the ${targetZone.name} officer.`,
    });

    const full = await prisma.complaint.findUnique({
      where: { id: complaint.id },
      include: complaintInclude,
    });

    res.json({
      complaint: serializeComplaint(full),
      message:
        routed.status === 'ESCALATED'
          ? 'Approved, but that zone has no officer - it is now with you.'
          : `Approved and routed to the ${targetZone.name} officer.` +
            (targetZone.id !== complaint.zoneId ? ' Zone corrected.' : ''),
    });
  }),
);

/** GET /api/admin/complaints - everything, filterable. */
router.get(
  '/complaints',
  asyncHandler(async (req, res) => {
    const { status, zoneCode, category } = req.query;

    const zone = zoneCode ? await prisma.zone.findUnique({ where: { code: Number(zoneCode) } }) : null;

    const complaints = await prisma.complaint.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(zone ? { zoneId: zone.id } : {}),
        ...(category ? { category } : {}),
      },
      include: complaintInclude,
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });

    res.json({ complaints: complaints.map(serializeComplaint) });
  }),
);

/** GET /api/admin/escalations - everything that fell through a crack. */
router.get(
  '/escalations',
  asyncHandler(async (_req, res) => {
    const complaints = await prisma.complaint.findMany({
      where: { status: 'ESCALATED' },
      include: complaintInclude,
      orderBy: { escalatedAt: 'asc' },
    });
    res.json({ complaints: complaints.map(serializeComplaint) });
  }),
);

/**
 * POST /api/admin/complaints/:id/force-allot  { workerUserId }
 * The admin's override: allot any worker on campus, ignoring zone.
 */
router.post(
  '/complaints/:id/force-allot',
  asyncHandler(async (req, res) => {
    const schema = z.object({ workerUserId: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'workerUserId is required');

    const complaint = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: { zone: true },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');

    const updated = await allotWorker({
      complaint: { ...complaint, zoneName: complaint.zone.name },
      workerUserId: parsed.data.workerUserId,
      actor: req.user,
    });

    res.json({ complaint: serializeComplaint(updated), message: 'Worker allotted by admin.' });
  }),
);

/** GET /api/admin/free-workers - every free worker on campus, by zone. */
router.get(
  '/free-workers',
  asyncHandler(async (_req, res) => {
    const zones = await prisma.zone.findMany({ orderBy: { code: 'asc' } });

    const result = [];
    for (const z of zones) {
      const free = await findFreeWorkers(z.id);
      result.push({
        zone: { code: z.code, name: z.name, label: z.label },
        workers: free.map((w) => ({
          userId: w.userId,
          name: w.user.name,
          tasksCompletedToday: w.tasksCompletedToday,
        })),
      });
    }

    res.json({ zones: result });
  }),
);

export { router as adminRouter };
