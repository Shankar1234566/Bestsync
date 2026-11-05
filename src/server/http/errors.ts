/**
 * Central error handling — final middleware of the chain.
 */
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../http/helpers';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Endpoint not found.' });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Malformed JSON body.' });
    return;
  }

  // Unexpected error — log for operators, never leak internals to clients.
  console.error('[beatsync] unhandled error:', error);
  res.status(500).json({ error: 'Internal server error.' });
}
