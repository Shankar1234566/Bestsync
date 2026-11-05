/**
 * JWT authentication middleware.
 * Tokens are issued by authService and sent as `Authorization: Bearer <token>`.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config';
import { HttpError } from '../http/helpers';

export interface AuthTokenPayload {
  sub: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export function signToken(userId: number, config: AppConfig): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    issuer: 'beatsync',
  } as jwt.SignOptions);
}

export function verifyToken(token: string, config: AppConfig): number | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { issuer: 'beatsync' }) as jwt.JwtPayload;
    const sub = Number(decoded.sub);
    return Number.isInteger(sub) && sub > 0 ? sub : null;
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/** Attaches `req.userId` when a valid token is present; never rejects. */
export function attachUser(config: AppConfig): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (token) {
      const userId = verifyToken(token, config);
      if (userId !== null) req.userId = userId;
    }
    next();
  };
}

/** Rejects requests without a valid token (401). */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.userId === undefined) {
    next(new HttpError(401, 'Sign in to use this endpoint.'));
    return;
  }
  next();
}

/** Returns the authenticated user id or throws 401. */
export function authedUserId(req: Request): number {
  if (req.userId === undefined) throw new HttpError(401, 'Sign in to use this endpoint.');
  return req.userId;
}
