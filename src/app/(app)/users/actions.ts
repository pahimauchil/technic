"use server";

import { revalidatePath } from "next/cache";

import { runAction, BusinessRuleError } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import type { UserRole } from "@/generated/prisma/enums";

const ASSIGNABLE_ROLES: UserRole[] = [
  "ADMIN",
  "MANAGER",
  "ACCOUNTANT",
  "SALES_STAFF",
  "PURCHASE_STAFF",
  "INVENTORY_MANAGER",
  "VIEWER",
];

export async function createUserAction(input: {
  name: string;
  email: string;
  accessCode: string;
  role: string;
  branchId: string;
}) {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const firmId = requireFirmId(actor);

    if (!/^\d{6}$/.test(input.accessCode)) {
      throw new BusinessRuleError("The login code must be exactly 6 digits");
    }
    if (!ASSIGNABLE_ROLES.includes(input.role as UserRole)) {
      throw new BusinessRuleError("That role cannot be assigned here");
    }

    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, firmId },
      select: { id: true },
    });
    if (!branch) throw new BusinessRuleError("That branch does not belong to your firm");

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: input.email.toLowerCase() }, { accessCode: input.accessCode }] },
      select: { email: true },
    });
    if (existing) {
      throw new BusinessRuleError("A user with that email or login code already exists");
    }

    const maxCode = await prisma.user.findFirst({
      where: { firmId },
      orderBy: { employeeCode: "desc" },
      select: { employeeCode: true },
    });
    const nextNumber = maxCode?.employeeCode ? Number(maxCode.employeeCode.replace(/\D/g, "")) + 1 : 2;
    const employeeCode = `EMP${String(nextNumber).padStart(4, "0")}`;

    const user = await prisma.user.create({
      data: {
        firmId,
        employeeCode,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        accessCode: input.accessCode,
        role: input.role as UserRole,
        branchId: branch.id,
        status: "ACTIVE",
      },
      select: { id: true, name: true },
    });

    await recordAudit({
      action: "USER_CREATED",
      entity: "User",
      entityId: user.id,
      summary: `${user.name} (${input.role})`,
      firmId,
      userId: actor.id,
    });

    revalidatePath("/users");
    return { name: user.name };
  });
}
