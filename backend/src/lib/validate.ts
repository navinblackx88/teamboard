import type { Request } from "express";
import { z } from "zod";
import { badRequest } from "./errors.js";

function parse<T extends z.ZodType>(schema: T, data: unknown, where: string): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(`Invalid ${where}`, r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}
// A POST with no body (no Content-Type) leaves req.body undefined; treat it as {} so optional bodies work.
export const body = <T extends z.ZodType>(req: Request, s: T) => parse(s, req.body ?? {}, "request body");
export const query = <T extends z.ZodType>(req: Request, s: T) => parse(s, req.query, "query parameters");

export const uuidParam = (req: Request, name: string): string => parse(z.uuid(), req.params[name], `path parameter '${name}'`);

// Query-string helpers
export const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(item)).optional();
export const qbool = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional();
export const limitParam = (def = 25, max = 100) => z.coerce.number().int().min(1).max(max).default(def);
