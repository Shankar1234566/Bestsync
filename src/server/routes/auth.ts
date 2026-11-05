/**
 * Auth routes: register, login, current session.
 */
import { Router } from 'express';
import type { AppContext } from '../context';
import {
  wrap,
  requireString,
  EMAIL_RE,
  USERNAME_RE,
  COUNTRY_RE,
  isRecord,
} from '../http/helpers';
import { authedUserId, requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { toPublicUser } from '../services/authService';

export function authRoutes(ctx: AppContext): Router {
  const router = Router();

  const authLimiter = rateLimit({
    bucket: 'auth',
    windowMs: 60_000,
    max: 20,
    keyOf: (req) => {
      const body = isRecord(req.body) ? req.body : {};
      const identity =
        typeof body.identifier === 'string' && body.identifier.length <= 254
          ? body.identifier.toLowerCase()
          : '';
      return `${req.ip ?? 'unknown'}:${identity}`;
    },
  });

  router.post(
    '/register',
    authLimiter,
    wrap((req, res) => {
      const body = isRecord(req.body) ? req.body : {};
      const username = requireString(body, 'username', {
        min: 3,
        max: 24,
        pattern: USERNAME_RE,
        label: 'Username',
      });
      const email = requireString(body, 'email', {
        min: 5,
        max: 254,
        pattern: EMAIL_RE,
        label: 'Email',
      }).toLowerCase();
      const password = requireString(body, 'password', { min: 1, max: 200, label: 'Password' });
      const country =
        typeof body.country === 'string' && COUNTRY_RE.test(body.country.trim())
          ? body.country.trim()
          : '';

      const result = ctx.auth.register({ username, email, password, country });
      res.status(201).json(result);
    }),
  );

  router.post(
    '/login',
    authLimiter,
    wrap((req, res) => {
      const body = isRecord(req.body) ? req.body : {};
      const identifier = requireString(body, 'identifier', {
        min: 1,
        max: 254,
        label: 'Username or email',
      });
      const password = requireString(body, 'password', { min: 1, max: 200, label: 'Password' });
      const result = ctx.auth.login(identifier, password);
      res.json(result);
    }),
  );

  router.get(
    '/me',
    requireAuth,
    wrap((req, res) => {
      const userId = authedUserId(req);
      const user = ctx.auth.byId(userId);
      if (!user) {
        res.status(401).json({ error: 'Account no longer exists.' });
        return;
      }
      const profile = ctx.auth.ensureProfile(userId);
      res.json({ user: toPublicUser(user, profile), profile: ctx.profile.summary(userId) });
    }),
  );

  return router;
}
