import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from './error.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

/**
 * Verifies the bearer token and hangs the full user (plus worker profile and
 * owned zone) off `req.user`, so route handlers never have to refetch it.
 */
export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) {
      throw new ApiError(401, 'Missing bearer token');
    }

    let payload;
    try {
      payload = jwt.verify(header.slice(7), env.jwtSecret);
    } catch {
      throw new ApiError(401, 'Invalid or expired token');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        workerProfile: { include: { zone: true } },
        zoneOwned: true,
      },
    });

    if (!user) throw new ApiError(401, 'Account no longer exists');
    if (!user.isActive) throw new ApiError(403, 'Account has been disabled');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Route guard: `requireRole('OFFICER', 'ADMIN')`. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Not authenticated'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, `This action requires: ${roles.join(' or ')}`));
    }
    next();
  };
}

/**
 * The worker approval gate. A worker who has signed up but not yet been
 * verified by the Admin can log in and see their "waiting for approval"
 * screen, but must not be able to touch any task endpoint.
 */
export function requireApprovedWorker(req, _res, next) {
  const profile = req.user?.workerProfile;
  if (!profile) return next(new ApiError(403, 'No worker profile on this account'));
  if (profile.approvalStatus !== 'ACTIVE') {
    return next(
      new ApiError(403, 'Your account is awaiting verification by the campus admin'),
    );
  }
  next();
}

/** Officer guard that also confirms they actually own a zone. */
export function requireZoneOfficer(req, _res, next) {
  if (req.user?.role === 'ADMIN') return next(); // admin may act anywhere
  if (!req.user?.zoneOwned) {
    return next(new ApiError(403, 'You are not assigned to any zone'));
  }
  next();
}
