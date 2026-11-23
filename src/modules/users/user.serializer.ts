import type { User } from "../../db/schema.js";
import { users } from "../../db/schema.js";

export const publicUserColumns = {
  id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl,
};
export type PublicUser = { id: string; name: string; email: string; avatarUrl: string | null };

export const toPublicUser = (u: User): PublicUser => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl });
export const toSelf = (u: User) => ({
  ...toPublicUser(u),
  emailNotifications: u.emailNotifications,
  hasPassword: Boolean(u.passwordHash),
  googleLinked: Boolean(u.googleId),
  createdAt: u.createdAt,
});
