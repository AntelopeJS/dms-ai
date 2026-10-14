import type { User } from "@antelopejs/interface-dms/auth/db";

/** The name a signed-in user is recorded under: their name, else their email. */
export function actorName(user: User): string {
  const name = user.name?.trim();
  return name ? name : user.email;
}
