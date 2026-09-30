import "server-only";

import { prisma } from "@/lib/prisma";
import type { TaxMode } from "@/generated/prisma/enums";
import type { PermissionCode } from "@/lib/rbac";
import {
  AuthenticationError,
  AuthorizationError,
  getCurrentUser,
  requireFirmId,
  type SessionUser,
} from "@/lib/session";

/**
 * Access-mode security. The handover spec is explicit: GST functionality must
 * be gated on the backend, not just hidden in the UI. The operational mode is
 * resolved from the server-side session (never from a client-supplied value)
 * and re-checked inside every server action and route handler that touches
 * tax-sensitive data.
 *
 * Mode rules:
 * - The mode is bound to the firm being operated in. A firm whose GSTIN is
 *   configured defaults to GST; otherwise NON_GST.
 * - A user entering a valid GST access code for that firm in this session
 *   operates in GST mode; a valid NON_GST code puts them in NON-GST mode.
 * - Sessions start in NON_GST by default (the least-privileged mode) and are
 *   escalated by entering a code. Entering a GST code grants GST; entering a
 *   NON_GST code (or no code) keeps NON_GST.
 * - PLATFORM_ADMINs entering a firm via the Firms module choose their mode
 *   explicitly there, and can also switch it from the mode switcher without
 *   a code (they administer the codes themselves).
 */

export interface AccessModeContext {
  firmId: string;
  mode: TaxMode;
}

export class AccessModeError extends Error {
  constructor(message = "This operation requires GST access mode") {
    super(message);
    this.name = "AccessModeError";
  }
}

/** The mode stored in the JWT/session for the current request. */
export function sessionAccessMode(user: Pick<SessionUser, "accessMode">): TaxMode {
  return user.accessMode === "GST" ? "GST" : "NON_GST";
}

/**
 * The default operational mode for a firm, used before any access code is
 * entered this session. GST-capable firms still require a GST access code to
 * actually work in GST mode — this only decides what NON_GST users see first.
 */
export async function firmDefaultMode(firmId: string): Promise<TaxMode> {
  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { gstin: true },
  });
  return firm?.gstin ? "GST" : "NON_GST";
}

export function requiresMode(permission: PermissionCode): boolean {
  return permission === "gst_reports.view";
}

/**
 * Authorize a server action or route handler: authentication + firm +
 * permission + access mode, all resolved server-side. Throws AuthorizationError
 * (403) when any layer fails — the route layer maps that to a 403 response.
 *
 * Use for GST-sensitive operations: gst_reports.view, tax invoice creation.
 */
export async function authorizeInMode(
  permission: PermissionCode | PermissionCode[],
  options: { requireMode?: TaxMode } = {},
): Promise<SessionUser & { activeFirmId: string; accessMode: TaxMode }> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  if (!user.activeFirmId) {
    throw new AuthorizationError("Select a firm before performing this action");
  }
  const wanted = Array.isArray(permission) ? permission : [permission];
  if (!wanted.some((code) => user.permissions.includes(code))) {
    throw new AuthorizationError();
  }
  const mode = sessionAccessMode(user);
  const required = options.requireMode ?? (wanted.includes("gst_reports.view") ? "GST" : undefined);
  if (required && mode !== required) {
    throw new AccessModeError(
      required === "GST"
        ? "This operation requires GST access mode. Enter a GST access code to continue."
        : "This operation is only available in non-GST mode.",
    );
  }
  return user as SessionUser & { activeFirmId: string; accessMode: TaxMode };
}

/**
 * Validate an access code against a firm. Returns the code's mode on success.
 * bcrypt compare is constant-work, so response timing does not reveal whether
 * the firm has any codes or how many.
 */
export async function validateAccessCode(
  firmId: string,
  code: string,
): Promise<{ ok: true; mode: TaxMode; codeId: string } | { ok: false; reason: "invalid" | "expired" | "inactive" }> {
  const bcrypt = await import("bcryptjs");
  const codes = await prisma.accessCode.findMany({
    where: { firmId, isActive: true },
    select: { id: true, codeHash: true, type: true, expiresAt: true },
  });

  let matched: { id: string; type: TaxMode; expiresAt: Date | null } | null = null;
  for (const candidate of codes) {
    if (await bcrypt.compare(code, candidate.codeHash)) {
      matched = candidate;
      break;
    }
  }
  if (!matched) return { ok: false, reason: "invalid" };
  if (matched.expiresAt && matched.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  await prisma.accessCode.update({
    where: { id: matched.id },
    data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
  });

  return { ok: true, mode: matched.type, codeId: matched.id };
}

/** Pages: mode from session without throwing. */
export async function requireModeContext(): Promise<AccessModeContext & { user: SessionUser }> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  const firmId = requireFirmId(user);
  return { firmId, mode: sessionAccessMode(user), user };
}
