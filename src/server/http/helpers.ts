/**
 * Shared HTTP helpers: typed errors, async wrapper, validation utilities.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  readonly status: number;
  readonly details?: Record<string, string>;

  constructor(status: number, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function wrap(
  handler: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result instanceof Promise) {
        result.catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}

/* ----------------------------- validation ----------------------------- */

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COUNTRY_RE = /^[A-Za-z .'-]{0,60}$/;

export function requireString(
  body: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number; pattern?: RegExp; label?: string } = {},
): string {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new HttpError(400, `${opts.label ?? field} is required.`, { [field]: 'required' });
  }
  const trimmed = value.trim();
  const min = opts.min ?? 1;
  const max = opts.max ?? 1000;
  if (trimmed.length < min) {
    throw new HttpError(400, `${opts.label ?? field} must be at least ${min} characters.`, {
      [field]: 'too_short',
    });
  }
  if (trimmed.length > max) {
    throw new HttpError(400, `${opts.label ?? field} must be at most ${max} characters.`, {
      [field]: 'too_long',
    });
  }
  if (opts.pattern && !opts.pattern.test(trimmed)) {
    throw new HttpError(400, `${opts.label ?? field} has an invalid format.`, {
      [field]: 'invalid_format',
    });
  }
  return trimmed;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  opts: { max?: number; pattern?: RegExp } = {},
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string.`, { [field]: 'invalid_type' });
  }
  const trimmed = value.trim();
  if (trimmed.length > (opts.max ?? 500)) {
    throw new HttpError(400, `${field} is too long.`, { [field]: 'too_long' });
  }
  if (opts.pattern && !opts.pattern.test(trimmed)) {
    throw new HttpError(400, `${field} has an invalid format.`, { [field]: 'invalid_format' });
  }
  return trimmed;
}

export function requireNumber(
  body: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, `${field} must be a finite number.`, { [field]: 'invalid_type' });
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new HttpError(400, `${field} must be >= ${opts.min}.`, { [field]: 'too_small' });
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new HttpError(400, `${field} must be <= ${opts.max}.`, { [field]: 'too_large' });
  }
  return value;
}

export function requireEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = body[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}.`, {
      [field]: 'invalid_enum',
    });
  }
  return value as T;
}

export function requireInt(
  body: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  const value = requireNumber(body, field, opts);
  if (!Number.isInteger(value)) {
    throw new HttpError(400, `${field} must be an integer.`, { [field]: 'not_integer' });
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { USERNAME_RE, EMAIL_RE, COUNTRY_RE };
