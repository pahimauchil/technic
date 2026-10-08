"use server";

import { revalidatePath } from "next/cache";

import { runAction, BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { AuthenticationError, AuthorizationError, getCurrentUser } from "@/lib/session";
import { isPlatformRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { TRASH_RETENTION_DAYS, trashRetentionElapsed } from "@/lib/firm-trash";
import { unstable_update } from "@/auth";

export async function enterFirmAction(input: { firmId: string }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!isPlatformRole(user.role) && user.role !== "ADMIN" && !user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("Only a Super Admin, Admin, or user with firm management permission can switch firms");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
      select: { id: true, name: true, status: true, deletedAt: true },
    });
    if (!firm || firm.status !== "ACTIVE") {
      throw new BusinessRuleError("That firm is not active");
    }
    if (firm.deletedAt) {
      throw new BusinessRuleError("That firm is in the trash — restore it first");
    }

    // Find a usable branch in the new firm to assign as the work location.
    // Without this the token would keep the previous firm's branchId and every
    // write would then be refused with "work location no longer valid".
    const branch = await prisma.branch.findFirst({
      where: { firmId: firm.id, isActive: true },
      select: { id: true, name: true, code: true },
    });

    await unstable_update({
      activeFirmId: firm.id,
      activeFirmName: firm.name,
      // Repoint the work location at the new firm's branch — or clear it when
      // the firm has none, so the user gets a clear "no branch" message
      // instead of cross-firm writes.
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
      branchCode: branch?.code ?? null,
    } as never);

    revalidatePath("/", "layout");
    return { entered: true };
  });
}

export async function createFirmAction(input: {
  code: string;
  name: string;
  legalName?: string;
  displayName?: string;
  gstin?: string;
  pan?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  website?: string;
  invoicePrefix?: string;
  quotationPrefix?: string;
  purchasePrefix?: string;
  financialYear?: string;
}) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("You do not have permission to create firms");
    }

    // Check if firm code already exists (a trashed firm keeps its code reserved)
    const existing = await prisma.firm.findUnique({
      where: { code: input.code },
      select: { code: true, deletedAt: true },
    });
    if (existing) {
      throw new BusinessRuleError(
        existing.deletedAt
          ? "A firm with this code already exists — it is sitting in the trash, restore or purge it first"
          : "A firm with this code already exists",
      );
    }

    const firm = await prisma.firm.create({
      data: {
        code: input.code,
        name: input.name,
        legalName: input.legalName || input.name,
        displayName: input.displayName,
        gstin: input.gstin,
        pan: input.pan,
        addressLine: input.addressLine,
        city: input.city,
        state: input.state,
        stateCode: input.stateCode,
        pincode: input.pincode,
        phone: input.phone,
        email: input.email,
        website: input.website,
        invoicePrefix: input.invoicePrefix || "INV",
        quotationPrefix: input.quotationPrefix || "QT",
        purchasePrefix: input.purchasePrefix || "PO",
        financialYear: input.financialYear || "26-27",
        status: "ACTIVE",
        branches: {
          create: {
            code: "HO",
            name: "Head Office",
            type: "HEAD_OFFICE",
            addressLine: input.addressLine,
            city: input.city,
            state: input.state,
            stateCode: input.stateCode,
            pincode: input.pincode,
            phone: input.phone,
            email: input.email,
            gstin: input.gstin,
            isActive: true,
          },
        },
      },
    });

    revalidatePath("/firms");
    return { created: true, firmId: firm.id };
  });
}

export async function editFirmAction(input: {
  firmId: string;
  name: string;
  legalName?: string;
  displayName?: string;
  gstin?: string;
  pan?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  website?: string;
  invoicePrefix?: string;
  quotationPrefix?: string;
  purchasePrefix?: string;
  financialYear?: string;
  status: "ACTIVE" | "INACTIVE";
}) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("You do not have permission to edit firms");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
    });
    if (!firm) {
      throw new NotFoundError("Firm not found");
    }

    await prisma.firm.update({
      where: { id: input.firmId },
      data: {
        name: input.name,
        legalName: input.legalName,
        displayName: input.displayName,
        gstin: input.gstin,
        pan: input.pan,
        addressLine: input.addressLine,
        city: input.city,
        state: input.state,
        stateCode: input.stateCode,
        pincode: input.pincode,
        phone: input.phone,
        email: input.email,
        website: input.website,
        invoicePrefix: input.invoicePrefix,
        quotationPrefix: input.quotationPrefix,
        purchasePrefix: input.purchasePrefix,
        financialYear: input.financialYear,
        status: input.status,
      },
    });

    revalidatePath("/firms");
    revalidatePath(`/firms/${input.firmId}/settings`);
    return { updated: true };
  });
}

/**
 * Moves a firm to the trash. Soft delete: the firm disappears from every
 * query immediately but all of its data is kept for TRASH_RETENTION_DAYS
 * before it is purged for good. The caller must type the firm's code, and the
 * server re-checks it — never trust the client's confirmation alone.
 */
export async function trashFirmAction(input: { firmId: string; confirmation: string }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("You do not have permission to move firms to the trash");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
      select: { id: true, code: true, name: true, displayName: true, deletedAt: true },
    });
    if (!firm) throw new NotFoundError("Firm not found");
    if (firm.deletedAt) throw new BusinessRuleError("That firm is already in the trash");

    const typed = (input.confirmation ?? "").trim();
    if (!typed) throw new BusinessRuleError(`Type ${firm.code} to confirm`);
    if (typed.toUpperCase() !== firm.code.toUpperCase()) {
      throw new BusinessRuleError("The confirmation does not match this firm's code");
    }

    if (user.activeFirmId === firm.id) {
      throw new BusinessRuleError("You are operating in this firm right now — switch to another firm first");
    }

    const deletedAt = new Date();
    await prisma.firm.update({ where: { id: firm.id }, data: { deletedAt } });

    await recordAudit({
      action: "FIRM_UPDATED",
      entity: "Firm",
      entityId: firm.id,
      summary: `Moved firm ${firm.code} (${firm.displayName || firm.name}) to the trash — purged after ${TRASH_RETENTION_DAYS} days`,
      before: { deletedAt: null },
      after: { deletedAt: deletedAt.toISOString() },
      firmId: firm.id,
      userId: user.id,
    });

    revalidatePath("/firms");
    revalidatePath(`/firms/${firm.id}/settings`);
    return { trashed: true };
  });
}

/** Puts a trashed firm back into service. The reverse of `trashFirmAction`. */
export async function restoreFirmAction(input: { firmId: string }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("You do not have permission to restore firms");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
      select: { id: true, code: true, name: true, displayName: true, deletedAt: true },
    });
    if (!firm) throw new NotFoundError("Firm not found");
    if (!firm.deletedAt) throw new BusinessRuleError("That firm is not in the trash");
    if (trashRetentionElapsed(firm.deletedAt)) {
      throw new BusinessRuleError(
        `Its ${TRASH_RETENTION_DAYS}-day retention has expired — this firm can no longer be restored`,
      );
    }

    await prisma.firm.update({
      where: { id: firm.id },
      data: { deletedAt: null, status: "ACTIVE" },
    });

    await recordAudit({
      action: "FIRM_UPDATED",
      entity: "Firm",
      entityId: firm.id,
      summary: `Restored firm ${firm.code} (${firm.displayName || firm.name}) from the trash`,
      before: { deletedAt: firm.deletedAt.toISOString() },
      after: { deletedAt: null },
      firmId: firm.id,
      userId: user.id,
    });

    revalidatePath("/firms");
    revalidatePath(`/firms/${firm.id}/settings`);
    return { restored: true };
  });
}
