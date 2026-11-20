import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/tokens.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: { id: string; email: string } }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized();
  const claims = verifyAccessToken(header.slice(7));
  req.user = { id: claims.sub, email: claims.email };
  next();
}

/** Narrow req.user after `authenticate` has run. */
export const me = (req: Request) => {
  if (!req.user) throw unauthorized();
  return req.user;
};
