import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { authenticate, requireRole, requireApprovedWorker } from '../middleware/auth.js';
import {
  uploadMedia,
  publicUrlFor,
  assertWithinTypeLimit,
  assertWithinDurationLimit,
} from '../middleware/upload.js';
import { transition, notify, notifyMany } from '../services/workflow.js';
import { releaseWorker } from '../services/allocation.js';
import {
  complaintInclude,
  serializeComplaint,
  loadComplaintForResponse,
} from '../utils/serialize.js';

const router = Router();

router.use(authenticate, requireRole('WORKER'));

/**
 * GET /api/worker/status
 * Deliberately NOT behind the approval gate - an unverified worker needs this
 * to render their "waiting for admin verification" screen.
 */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const profile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.id },
      include: { zone: { select: { id: true, code: true, name: true, label: true, colorHex: true } } },
    });
    if (!profile) throw new ApiError(404, 'No worker profile on this account');

    res.json({
      approvalStatus: profile.approvalStatus,
      rejectionNote: profile.rejectionNote,
      dutyStatus: profile.dutyStatus,
      availability: profile.availability,
      activeTaskCount: profile.activeTaskCount,
      tasksCompletedToday: profile.tasksCompletedToday,
      tasksCompletedTotal: profile.tasksCompletedTotal,
      zone: profile.zone,
    });
  }),
);

// Everything past this point requires admin verification.
router.use(requireApprovedWorker);

/**
 * POST /api/worker/duty  { dutyStatus: "ON" | "OFF" }
 * Clocking off is refused while holding a live task, otherwise a complaint
 * would be stranded with nobody accountable for it.
 */
router.post(
  '/duty',
  asyncHandler(async (req, res) => {
    const schema = z.object({ dutyStatus: z.enum(['ON', 'OFF']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'dutyStatus must be ON or OFF');

    const profile = await prisma.workerProfile.findUnique({ where: { userId: req.user.id } });

    if (parsed.data.dutyStatus === 'OFF' && profile.activeTaskCount > 0) {
      throw new ApiError(409, 'Finish or hand back your current task before going off duty');
    }

    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.id },
      data: { dutyStatus: parsed.data.dutyStatus },
    });

    res.json({
      dutyStatus: updated.dutyStatus,
      availability: updated.availability,
      message: updated.dutyStatus === 'ON' ? 'You are on duty.' : 'You are off duty.',
    });
  }),
);

/** GET /api/worker/tasks - live task first, then recent history. */
router.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const [active, history] = await Promise.all([
      prisma.complaint.findMany({
        where: {
          assignedWorkerId: req.user.id,
          status: { in: ['ALLOTTED_TO_WORKER', 'IN_PROGRESS', 'REOPENED', 'WORK_DONE'] },
        },
        include: complaintInclude,
        orderBy: { allottedWorkerAt: 'asc' },
      }),
      prisma.complaint.findMany({
        where: {
          assignedWorkerId: req.user.id,
          status: { in: ['CLOSED', 'AUTO_CLOSED'] },
        },
        include: complaintInclude,
        orderBy: { closedAt: 'desc' },
        take: 30,
      }),
    ]);

    res.json({
      active: active.map(serializeComplaint),
      history: history.map(serializeComplaint),
    });
  }),
);

/** Load a task and confirm it really belongs to this worker. */
async function loadOwnTask(req) {
  const complaint = await prisma.complaint.findUnique({
    where: { id: req.params.id },
    include: { zone: true },
  });
  if (!complaint) throw new ApiError(404, 'Task not found');
  if (complaint.assignedWorkerId !== req.user.id) {
    throw new ApiError(403, 'This task is not assigned to you');
  }
  return complaint;
}

/** POST /api/worker/tasks/:id/start */
router.post(
  '/tasks/:id/start',
  asyncHandler(async (req, res) => {
    const complaint = await loadOwnTask(req);

    if (!['ALLOTTED_TO_WORKER', 'REOPENED'].includes(complaint.status)) {
      throw new ApiError(409, `You cannot start a task that is ${complaint.status}`);
    }

    await transition({
      complaintId: complaint.id,
      toStatus: 'IN_PROGRESS',
      actor: req.user,
      note: complaint.status === 'REOPENED' ? 'Worker restarted after rework' : 'Worker started',
    });
    const updated = await loadComplaintForResponse(prisma, complaint.id);

    await notify({
      userId: complaint.reporterId,
      complaintId: complaint.id,
      title: 'Work started',
      body: `${complaint.ref}: ${req.user.name} has started work.`,
    });

    res.json({ complaint: serializeComplaint(updated), message: 'Task started.' });
  }),
);

/**
 * POST /api/worker/tasks/:id/done
 *
 * Proof of work is compulsory: at least one AFTER attachment. Without it the
 * resident has nothing to judge, and the satisfaction step is meaningless.
 *
 * Note the worker is NOT released here - they stay attached until the resident
 * responds, so a rejection can go straight back to the same person.
 */
router.post(
  '/tasks/:id/done',
  uploadMedia.array('media', 5),
  asyncHandler(async (req, res) => {
    const files = req.files ?? [];
    const cleanUp = () => files.forEach((f) => fs.unlink(f.path, () => {}));

    let complaint;
    try {
      complaint = await loadOwnTask(req);
    } catch (err) {
      cleanUp();
      throw err;
    }

    if (complaint.status !== 'IN_PROGRESS') {
      cleanUp();
      throw new ApiError(409, 'Start the task before marking it done');
    }
    if (!files.length) {
      throw new ApiError(400, 'Attach at least one photo of the completed work');
    }

    let meta = [];
    if (req.body?.mediaMeta) {
      try {
        meta = JSON.parse(req.body.mediaMeta);
        if (!Array.isArray(meta)) meta = [];
      } catch {
        cleanUp();
        throw new ApiError(400, 'mediaMeta must be a JSON array');
      }
    }

    const prepared = [];
    try {
      for (const [i, file] of files.entries()) {
        const type = assertWithinTypeLimit(file);
        const m = meta[i] ?? {};
        assertWithinDurationLimit(type, m.durationSec);

        prepared.push({
          complaintId: complaint.id,
          url: publicUrlFor(file.filename),
          type,
          phase: 'AFTER',
          mimeType: file.mimetype,
          sizeBytes: file.size,
          durationSec: m.durationSec ?? null,
          capturedLat: m.lat ?? complaint.lat,
          capturedLng: m.lng ?? complaint.lng,
          capturedAt: m.capturedAt ? new Date(m.capturedAt) : new Date(),
          uploadedById: req.user.id,
        });
      }
    } catch (err) {
      cleanUp();
      throw err;
    }

    await prisma.media.createMany({ data: prepared });

    const updated = await transition({
      complaintId: complaint.id,
      toStatus: 'WORK_DONE',
      actor: req.user,
      note: req.body?.note ? `Worker: ${req.body.note}` : 'Work completed, proof uploaded',
    });

    await notifyMany([
      {
        userId: complaint.reporterId,
        complaintId: complaint.id,
        title: 'Please confirm the work',
        body: `${complaint.ref} has been completed. Open the app to approve or send it back.`,
      },
      {
        userId: complaint.assignedOfficerId,
        complaintId: complaint.id,
        title: 'Work completed',
        body: `${complaint.ref} is done and awaiting the resident's confirmation.`,
      },
    ]);

    const full = await prisma.complaint.findUnique({
      where: { id: complaint.id },
      include: complaintInclude,
    });

    res.json({
      complaint: serializeComplaint({ ...full, ...updated, media: full.media }),
      message: 'Marked done. Waiting for the resident to confirm.',
    });
  }),
);

/**
 * POST /api/worker/tasks/:id/hand-back  { reason }
 * Escape hatch - a worker who cannot do the job (wrong tools, unsafe, wrong
 * location) returns it to their officer instead of sitting on it until the
 * SLA blows.
 */
router.post(
  '/tasks/:id/hand-back',
  asyncHandler(async (req, res) => {
    const schema = z.object({ reason: z.string().min(3).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'A reason is required');

    const complaint = await loadOwnTask(req);
    if (!['ALLOTTED_TO_WORKER', 'IN_PROGRESS', 'REOPENED'].includes(complaint.status)) {
      throw new ApiError(409, 'This task cannot be handed back');
    }

    await releaseWorker(req.user.id, { completed: false });

    await transition({
      complaintId: complaint.id,
      toStatus: 'ALLOTTED_TO_OFFICER',
      actor: req.user,
      note: `Handed back by ${req.user.name}: ${parsed.data.reason}`,
      data: { assignedWorkerId: null },
    });
    const updated = await loadComplaintForResponse(prisma, complaint.id);

    await notify({
      userId: complaint.assignedOfficerId,
      complaintId: complaint.id,
      title: 'Task handed back',
      body: `${req.user.name} returned ${complaint.ref}: ${parsed.data.reason}`,
    });

    res.json({ complaint: serializeComplaint(updated), message: 'Returned to your zone officer.' });
  }),
);

export { router as workerRouter };
