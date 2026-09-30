"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { auth, unstable_update } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  checkAccessCodeAttempt,
  clearAccessCodeAttempts,
  recordAccessCodeFailure,
  sweepRateLimits,
} from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { validateAccessCode } from "@/lib/access-mode";
import { isPlatformRole, PERMISSIONS } from "@/lib/rbac";
import { requireFirmId, type SessionUser } from "@/lib/session";
import type { ActionResult } from "@/lib/action-result";
import type { TaxMode } from "@/generated/prisma/enums";

/**
 * The server side of the access-mode gate. Mode lives in the JWT; escalating
 * to GST requires a valid GST access code for the active firm — validated
 * here, never trusted from the client. Failed attempts are rate-limited and
 * locked out, and every attempt (success or failure) is audited.
 */
export async function switchAccessMode(input: { code?: string }): Promise<ActionResult<{ mode: TaxMode }>> {
  sweepRateLimits();
  const user: SessionUser | null = await auth()
    .then((session) =>
      session?.user?.id
        ? ({
            id: session.user.id,
            name: session.user.name ?? "",
            email: session.user.email ?? "",
            role: session.user.role,
            branchId: session.user.branchId ?? null,
            permissions: session.user.permissions ?? [],
            firmId: session.user.firmId ?? null,
            activeFirmId: session.user.activeFirmId ?? null,
          } as SessionUser)
        : null,
    );
  if (!user || !user.activeFirmId) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const firmId = requireFirmId(user);
  const code = (input.code ?? "").trim();

  // PLATFORM_ADMINs administer the codes and may switch modes directly.
  const canSkipCode = isPlatformRole(user.role) && user.permissions.includes(PERMISSIONS.ACCESS_CODES_MANAGE);

  if (code === "") {
    // No code supplied = a deliberate downgrade to NON_GST, always allowed.
    await updateSessionMode("NON_GST");
    await recordAudit({
      action: "ACCESS_CODE_USED",
      entity: "Session",
      summary: "Switched to non-GST mode",
      firmId,
      userId: user.id,
      ipAddress: ip,
    });
    revalidatePath("/", "layout");
    return { ok: true, data: { mode: "NON_GST" } };
  }

  if (!canSkipCode) {
    const attempt = checkAccessCodeAttempt(firmId, code);
    if (!attempt.allowed) {
      await recordAudit({
        action: "ACCESS_CODE_FAILED",
        entity: "AccessCode",
        summary: `Locked out after repeated failures (${attempt.lockedForSeconds}s remaining)`,
        firmId,
        userId: user.id,
        ipAddress: ip,
      });
      return {
        ok: false,
        error: `Too many failed attempts. Try again in ${Math.ceil(attempt.lockedForSeconds / 60)} minute(s).`,
      };
    }
  }

  const result = await validateAccessCode(firmId, code);

  if (!result.ok) {
    const failure = canSkipCode
      ? { allowed: true, remainingAttempts: 5, lockedForSeconds: 0 }
      : recordAccessCodeFailure(firmId, code);
    await recordAudit({
      action: "ACCESS_CODE_FAILED",
      entity: "AccessCode",
      summary: `Invalid ${result.reason} access code`,
      firmId,
      userId: user.id,
      ipAddress: ip,
    });
    return {
      ok: false,
      error:
        result.reason === "expired"
          ? "This access code has expired. Ask a Super Admin for a new one."
          : result.reason === "inactive"
            ? "This access code has been disabled."
            : failure.lockedForSeconds > 0
              ? `Invalid code. Attempts locked for ${Math.ceil(failure.lockedForSeconds / 60)} minute(s).`
              : `Invalid code. ${failure.remainingAttempts} attempt(s) remaining.`,
    };
  }

  clearAccessCodeAttempts(firmId, code);
  await updateSessionMode(result.mode);
  await recordAudit({
    action: "ACCESS_CODE_USED",
    entity: "AccessCode",
    entityId: result.codeId,
    summary: `Access code accepted — operating in ${result.mode} mode`,
    firmId,
    userId: user.id,
    ipAddress: ip,
  });
  revalidatePath("/", "layout");
  return { ok: true, data: { mode: result.mode } };
}

/** Updates the JWT via NextAuth v5's server-side update API. */
async function updateSessionMode(mode: TaxMode): Promise<void> {
  await unstable_update({ accessMode: mode } as never);
}
