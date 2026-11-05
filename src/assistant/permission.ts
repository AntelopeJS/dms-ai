import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { RoleModel, TenantMemberModel } from "@antelopejs/interface-dms/db";
import {
  GetEffectiveUserPermissions,
  HasPermission,
  RegisterPermission,
  UnregisterPermission,
} from "@antelopejs/interface-dms/permissions";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { AssertTenantAccess } from "@antelopejs/interface-dms/tenant-access";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  ASSISTANT_MODES,
  ASSISTANT_PERMISSION_ICON,
  ASSISTANT_PERMISSION_ID,
  type AssistantMode,
  HTTP_FORBIDDEN,
} from "../constants/assistant";
import { I18N_SECTIONS } from "../constants/i18n";
import { isDevelopment } from "../runtime-mode";
import { i18nKey } from "../vocabulary";

/** Offered in the roles editor; owners hold it through `*`. */
export function registerAssistantPermission(): void {
  RegisterPermission(ASSISTANT_PERMISSION_ID, {
    id: ASSISTANT_PERMISSION_ID,
    title: i18nKey(I18N_SECTIONS.MODULE, "permission", "title"),
    description: i18nKey(I18N_SECTIONS.MODULE, "permission", "description"),
    icon: ASSISTANT_PERMISSION_ICON,
  });
}

export function unregisterAssistantPermission(): void {
  UnregisterPermission(ASSISTANT_PERMISSION_ID);
}

/** A signed-in user allowed to chat, in the tenant their credential names. */
export interface AssistantUser {
  user: User;
  tenantId: string;
  /** The modes this user may run: Builder only for an owner in development. */
  modes: AssistantMode[];
}

async function holdsAssistantPermission(
  user: User,
  tenantId: string,
): Promise<boolean> {
  const member = await GetModel(TenantMemberModel, tenantId).getByUser(
    user._id,
  );
  const permissions = await GetEffectiveUserPermissions(
    user,
    tenantId,
    member?.roleIds ?? [],
    GetModel(RoleModel, tenantId),
  );
  return HasPermission(permissions, ASSISTANT_PERMISSION_ID);
}

export function assistantModes(user: User): AssistantMode[] {
  if (user.owner === true && isDevelopment()) return [...ASSISTANT_MODES];
  return ["analyst"];
}

/**
 * Checks what the route's `AuthUser` let through: the user reaches the tenant
 * their credential names and holds the assistant permission there.
 *
 * @throws HTTPResult 403 otherwise
 */
export async function authorizeAssistantUser(
  ctx: RequestContext,
  user: User,
): Promise<AssistantUser> {
  const tenantId = getRequestTenantId(ctx);
  await AssertTenantAccess(user._id, tenantId);
  if (!(await holdsAssistantPermission(user, tenantId))) {
    throw new HTTPResult(HTTP_FORBIDDEN, {
      error: "missing_permission",
      permission: ASSISTANT_PERMISSION_ID,
    });
  }
  return { user, tenantId, modes: assistantModes(user) };
}
