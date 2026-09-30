"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { approveSalesReturn } from "@/lib/services/payments";

export async function approveSalesReturnAction(input: { returnId: string }) {
  return runAction(async () => {
    const user = await authorize(["invoice.cancel", "sales.cancel"]);
    const firmId = requireFirmId(user);
    await approveSalesReturn(firmId, input.returnId, user.id);
    revalidatePath("/sales-returns");
    revalidatePath("/inventory");
    return { approved: true };
  });
}
