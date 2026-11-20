import { badRequest } from "./errors.js";

/** Opaque keyset cursor: base64url(JSON [sortValue, id]). */
export type Cursor = { v: string | number; id: string };

export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify([c.v, c.id])).toString("base64url");
export function decodeCursor(raw?: string): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const [v, id] = JSON.parse(Buffer.from(raw, "base64url").toString());
    if ((typeof v !== "string" && typeof v !== "number") || typeof id !== "string") throw new Error();
    return { v, id };
  } catch {
    throw badRequest("Invalid cursor");
  }
}

export function pageOf<T>(rows: T[], limit: number, toCursor: (row: T) => Cursor) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(toCursor(items[items.length - 1])) : null };
}
