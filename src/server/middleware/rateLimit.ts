/**
 * In-memory sliding-window rate limiter — dependency-free and sufficient
 * for a single-instance deployment (documented in ARCHITECTURE.md).
 */
import type { Request, RequestHandler } from 'express';
import { HttpError } from '../http/helpers';

interface Window {
  hits: number[];
}

const store = new Map<string, Window>();
let lastSweep = Date.now();

function sweep(now: number, windowMs: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, window] of store) {
    window.hits = window.hits.filter((t) => now - t < windowMs);
    if (window.hits.length === 0) store.delete(key);
  }
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Bucket name so different limits do not share counters. */
  bucket: string;
  /** Override the identity key (defaults to IP). */
  keyOf?: (req: Request) => string;
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    sweep(now, options.windowMs);
    const identity = options.keyOf?.(req) ?? req.ip ?? 'unknown';
    const key = `${options.bucket}:${identity}`;

    let window = store.get(key);
    if (!window) {
      window = { hits: [] };
      store.set(key, window);
    }
    window.hits = window.hits.filter((t) => now - t < options.windowMs);

    if (window.hits.length >= options.max) {
      const oldest = window.hits[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((options.windowMs - (now - oldest)) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      next(
        new HttpError(429, 'Too many requests — please slow down a little and try again.'),
      );
      return;
    }

    window.hits.push(now);
    next();
  };
}

/** Test helper — clears all counters. */
export function resetRateLimits(): void {
  store.clear();
  lastSweep = Date.now();
}
