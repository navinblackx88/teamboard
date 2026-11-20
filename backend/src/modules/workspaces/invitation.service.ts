import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { invitations, users, workspaceMembers, workspaces, type User } from "../../db/schema.js";
import { badRequest, forbidden, HttpError, notFound } from "../../lib/errors.js";
import { sha256 } from "../../lib/tokens.js";
import { broadcast } from "../../realtime/io.js";
import { logActivity } from "../activity/activity.service.js";

export async function findInvitation(token: string) {
  const [row] = await db.select({
    invitation: invitations,
    workspaceName: workspaces.name,
    invitedByName: users.name,
  }).from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .innerJoin(users, eq(users.id, invitations.invitedById))
    .where(eq(invitations.tokenHash, sha256(token)));
  if (!row) throw notFound("Invitation");
  return row;
}

export async function acceptInvitation(token: string, user: Pick<User, "id" | "email" | "name">) {
  const { invitation: inv } = await findInvitation(token);
  if (inv.acceptedAt) throw new HttpError(410, "invitation_used", "This invitation has already been used");
  if (inv.expiresAt < new Date()) throw new HttpError(410, "invitation_expired", "This invitation has expired");
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that address to accept it.`);
  }
  await db.transaction(async (tx) => {
    const [claimed] = await tx.update(invitations).set({ acceptedAt: new Date() })
      .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt))).returning();
    if (!claimed) throw badRequest("Invitation already accepted");
    await tx.insert(workspaceMembers).values({ workspaceId: inv.workspaceId, userId: user.id, role: inv.role }).onConflictDoNothing();
  });
  await logActivity({
    workspaceId: inv.workspaceId, actorId: user.id, action: "member.joined", entityType: "member",
    entityId: user.id, summary: `${user.name} joined the workspace as ${inv.role.replace("_", " ")}`,
  });
  broadcast.workspace(inv.workspaceId, "member.changed", { userId: user.id });
  return { workspaceId: inv.workspaceId };
}
