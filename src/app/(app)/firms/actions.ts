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
    if (!isPlatformRole(user.role)) {
      throw new Error("Only a Super Admin can switch firms");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
      select: { id: true, name: true, status: true },
    });
    if (!firm || firm.status !== "ACTIVE") {
      throw new Error("That firm is not active");
    }

    await unstable_update({
      activeFirmId: firm.id,
      activeFirmName: firm.name,
      accessMode: "NON_GST",
    } as never);

    revalidatePath("/", "layout");
    return { entered: true };
  });
}
