import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ROLE_RANK, type Role } from '@wa/shared';
import { config } from '../config';
import { prisma } from '../db';
import { HttpError, forbidden } from '../lib/http';

export const SESSION_COOKIE = 'wa_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
  email: string;
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    rawBody?: Buffer;
  }
}

export function issueSession(res: Response, userId: string, orgId: string) {
  const token = jwt.sign({ sub: userId, org: orgId }, config.jwtSecret, { expiresIn: SESSION_TTL_SECONDS });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  });
  return token;
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Verifies the session cookie (or a Bearer token for API clients) and loads the
 * caller's membership. Every protected query is then scoped to req.auth.orgId.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const token =
      req.cookies?.[SESSION_COOKIE] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to continue');
    let payload: { sub: string; org: string };
    try {
      payload = jwt.verify(token, config.jwtSecret) as { sub: string; org: string };
    } catch {
      throw new HttpError(401, 'unauthorized', 'Your session has expired. Sign in again.');
    }
    const membership = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: payload.sub, organizationId: payload.org } },
      include: { user: true },
    });
    if (!membership) throw new HttpError(401, 'unauthorized', 'Sign in to continue');
    req.auth = {
      userId: membership.userId,
      orgId: membership.organizationId,
      role: membership.role as Role,
      email: membership.user.email,
      name: membership.user.name,
    };
    next();
  } catch (e) {
    next(e);
  }
}

/** Allows the request only when the caller's role is at least `min`. */
export const requireRole = (min: Role) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(new HttpError(401, 'unauthorized', 'Sign in to continue'));
  if (ROLE_RANK[req.auth.role] < ROLE_RANK[min])
    return next(forbidden(`This action needs the ${min.toLowerCase()} role or higher`));
  next();
};

/** Shorthand used by route modules. */
export const orgId = (req: Request) => req.auth!.orgId;

/**
 * CSRF defence for cookie sessions: state-changing requests must be JSON
 * (cross-site forms cannot send JSON without a CORS preflight, which we restrict).
 */
export function requireJsonForMutations(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.is('application/json') || req.headers['content-length'] === '0' || !req.headers['content-type'])
    return next();
  next(new HttpError(415, 'unsupported_media_type', 'Requests must use Content-Type: application/json'));
}
