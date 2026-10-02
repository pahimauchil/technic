import "server-only";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isGlobalRole, isPlatformRole, type PermissionCode } from "@/lib/rbac";
import type { AccessView } from "@/types/next-auth";
import type { TaxMode, UserRole } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  employeeCode: string | null;
  permissions: PermissionCode[];
  /** The firm this user's own account belongs to. Null only for PLATFORM_ADMIN. */
  firmId: string | null;
  firmName: string | null;
  /**
   * The firm actually being operated in for this request. Equal to firmId
   * for every ordinary firm user (fixed, never switchable). For
   * PLATFORM_ADMIN this is whichever firm they last "entered" via the Firms
   * module's switcher — null until they do.
   */
  activeFirmId: string | null;
  activeFirmName: string | null;
  /**
   * Which transaction stream this session may see: COMBINED (both tax
   * invoices and bills — the default, and the full view for the
   * Super Admin) or GST_ONLY (an internal GST-reconciliation view; only
   * GST transactions are visible). Enforced on every backend read path.
   */
  accessView: AccessView;
}

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  constructor(message = "You must be signed in") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const firmId = session.user.firmId ?? null;
  if (firmId) {
    // JWT sessions are stateless, so a firm deactivated after a user's
    // token was issued would otherwise keep working until the token next
    // refreshes. Re-verified on every request.
    const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { status: true } });
    if (!firm || firm.status !== "ACTIVE") return null;
  }

  return {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    image: session.user.image,
    role: session.user.role,
    branchId: session.user.branchId,
    branchName: session.user.branchName,
    branchCode: session.user.branchCode,
    employeeCode: session.user.employeeCode,
    permissions: session.user.permissions ?? [],
    firmId: session.user.firmId ?? null,
    firmName: session.user.firmName ?? null,
    activeFirmId: session.user.activeFirmId ?? null,
    activeFirmName: session.user.activeFirmName ?? null,
    accessView: session.user.accessView === "GST_ONLY" ? "GST_ONLY" : "COMBINED",
  };
}

/** For pages: bounces to /login when there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function hasPermission(
  user: Pick<SessionUser, "permissions">,
  permission: PermissionCode | PermissionCode[],
): boolean {
  const wanted = Array.isArray(permission) ? permission : [permission];
  return wanted.some((code) => user.permissions.includes(code));
}

export function hasAllPermissions(
  user: Pick<SessionUser, "permissions">,
  permissions: PermissionCode[],
): boolean {
  return permissions.every((code) => user.permissions.includes(code));
}

/** For pages: 403 page when the signed-in user lacks the permission. */
export async function requirePermission(
  permission: PermissionCode | PermissionCode[],
): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user, permission)) redirect("/forbidden");
  return user;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function authorize(
  permission: PermissionCode | PermissionCode[],
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  if (!hasPermission(user, permission)) throw new AuthorizationError();
  return user;
}

/**
 * The Prisma `taxMode` filter implied by the session's view stream. In the
 * COMBINED view it is undefined (no filtering — both transaction kinds);
 * in the GST_ONLY view it restricts every tax-mode-aware query to GST
 * records. Reads it from the session — never from request data.
 */
export function taxModeWhere(
  user: Pick<SessionUser, "accessView">,
): { taxMode?: TaxMode } {
  return user.accessView === "GST_ONLY" ? { taxMode: "GST" as const } : {};
}

/**
 * The tenant boundary every operational query must filter by. Never reads
 * from a request body, query string, or client-supplied value — always the
 * server-resolved session.
 */
export function requireFirmId(user: SessionUser): string {
  if (!user.activeFirmId) {
    throw new AuthorizationError(
      isPlatformRole(user.role)
        ? "Select a firm from the Firms module before accessing operational data."
        : "Your account is not assigned to a firm.",
    );
  }
  return user.activeFirmId;
}

/** For pages: 403 page instead of throwing when no firm is active. */
export async function requirePermissionInFirm(
  permission: PermissionCode | PermissionCode[],
): Promise<SessionUser & { activeFirmId: string }> {
  const user = await requirePermission(permission);
  if (!user.activeFirmId) redirect("/firms");
  return user as SessionUser & { activeFirmId: string };
}

/**
 * Branch scoping. Global roles may query any branch within their own firm
 * (or all of them); everyone else is pinned to the branch they belong to,
 * whatever the request asks for. `firmId` is always the caller's own
 * resolved tenant — every query built from this result MUST also filter by
 * it.
 */
export function resolveBranchScope(
  user: SessionUser,
  requestedBranchId?: string | null,
): { branchId?: string; canSeeAllBranches: boolean; firmId: string } {
  const firmId = requireFirmId(user);
  const canSeeAllBranches =
    isGlobalRole(user.role) ||
    user.permissions.includes("dashboard.view_all_branches" as PermissionCode);

  if (!canSeeAllBranches) {
    return { branchId: user.branchId ?? "__no_branch__", canSeeAllBranches: false, firmId };
  }

  if (requestedBranchId && requestedBranchId !== "all") {
    return { branchId: requestedBranchId, canSeeAllBranches: true, firmId };
  }

  return { branchId: undefined, canSeeAllBranches: true, firmId };
}

/**
 * Throws if a user tries to touch a record belonging to another branch.
 * Firm-safe by construction: a user's own branchId is only ever assigned
 * from a branch in their own firm (enforced at staff-creation time).
 */
export function assertBranchAccess(user: SessionUser, branchId: string | null) {
  if (isGlobalRole(user.role)) return;
  if (!branchId) return;
  if (user.branchId !== branchId) {
    throw new AuthorizationError("This record belongs to a different branch");
  }
}

/**
 * Throws (403-equivalent) if a fetched record's own firmId doesn't match
 * the caller's active firm.
 */
export function assertFirmAccess(user: SessionUser, recordFirmId: string | null | undefined) {
  const firmId = requireFirmId(user);
  if (recordFirmId !== firmId) {
    throw new AuthorizationError("This record belongs to a different organization");
  }
}

/**
 * The branch a newly created record should be filed under. For a global
 * role that requested a specific branch, the branch is verified to belong
 * to the caller's own firm before being trusted.
 */
export async function requireWriteBranch(
  user: SessionUser,
  requestedBranchId?: string | null,
): Promise<string> {
  const firmId = requireFirmId(user);

  if (isGlobalRole(user.role)) {
    const branchId = requestedBranchId ?? user.branchId;
    if (!branchId) throw new AuthorizationError("A branch must be selected");
    // Always validate: the session fallback can go stale after data resets.
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { firmId: true },
    });
    if (!branch || branch.firmId !== firmId) {
      throw new AuthorizationError(
        requestedBranchId
          ? "That branch does not belong to your organization"
          : "Your saved work location is no longer valid — sign out and back in",
      );
    }
    return branchId;
  }

  if (!user.branchId) {
    throw new AuthorizationError("Your account is not assigned to a branch");
  }
  if (requestedBranchId && requestedBranchId !== user.branchId) {
    throw new AuthorizationError("You can only create records for your own branch");
  }
  // Validate the account's branch still exists in this firm.
  const branch = await prisma.branch.findUnique({
    where: { id: user.branchId },
    select: { firmId: true },
  });
  if (!branch || branch.firmId !== firmId) {
    throw new AuthorizationError(
      "Your work location is no longer valid — ask an administrator to check your account",
    );
  }
  return user.branchId;
}
