import { db, type Tx } from "../../db/index.js";
import { activityLogs } from "../../db/schema.js";
import { broadcast } from "../../realtime/io.js";
import { invalidateScope } from "../../lib/redis.js";

export type ActivityInput = {
  workspaceId: string;
  projectId?: string | null;
  taskId?: string | null;
  actorId: string | null;
  action: string;
  entityType: "workspace" | "project" | "task" | "sprint" | "comment" | "attachment" | "member" | "label";
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

/** Records an activity entry, pushes it to the workspace feed, and invalidates cached dashboards. */
export async function logActivity(entry: ActivityInput, tx: Tx | typeof db = db) {
  const [row] = await tx.insert(activityLogs).values({ ...entry, metadata: entry.metadata ?? {} }).returning();
  broadcast.workspace(entry.workspaceId, "activity.created", { activity: row });
  await invalidateScope(`ws:${entry.workspaceId}`);
  return row;
}
