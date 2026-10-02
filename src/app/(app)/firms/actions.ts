"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/session";
import { isPlatformRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { unstable_update } from "@/auth";

export async function enterFirmAction(input: { firmId: string }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Sign in again");
    if (!isPlatformRole(user.role) && user.role !== "ADMIN" && !user.permissions.includes("firms.manage" as const)) {
      throw new Error("Only a Super Admin, Admin, or user with firm management permission can switch firms");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
      select: { id: true, name: true, status: true },
    });
    if (!firm || firm.status !== "ACTIVE") {
      throw new Error("That firm is not active");
    }

    // Find the first active branch in the new firm to assign as the work location
    const branch = await prisma.branch.findFirst({
      where: { firmId: firm.id, isActive: true },
      select: { id: true },
    });

    await unstable_update({
      activeFirmId: firm.id,
      activeFirmName: firm.name,
      // Update the branch to the new firm's branch so operations work
      branchId: branch?.id ?? null,
      branchName: null, // Will be refreshed on next session load
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
    if (!user) throw new Error("Sign in again");
    if (!user.permissions.includes("firms.manage" as const)) {
      throw new Error("You do not have permission to create firms");
    }

    // Check if firm code already exists
    const existing = await prisma.firm.findUnique({
      where: { code: input.code },
    });
    if (existing) {
      throw new Error("A firm with this code already exists");
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
    if (!user) throw new Error("Sign in again");
    if (!user.permissions.includes("firms.manage" as const)) {
      throw new Error("You do not have permission to edit firms");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
    });
    if (!firm) {
      throw new Error("Firm not found");
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
    return { updated: true };
  });
}
