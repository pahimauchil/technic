"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { createQuotation } from "@/lib/services/sales";

export async function createQuotationAction(input: {
  customerId: string;
  taxMode: "GST" | "NON_GST";
  validUntil?: string | null;
  notes?: string | null;
  lines: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    gstRate?: number;
    serialNumbers?: string[];
  }[];
}) {
  return runAction(async () => {
    const user = await authorize("quotation.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    if (!input.lines?.length) {
      throw new Error("Add at least one item to the quotation");
    }

    const quotation = await createQuotation({
      firmId,
      branchId,
      customerId: input.customerId,
      taxMode: input.taxMode,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      notes: input.notes ?? null,
      lines: input.lines,
      userId: user.id,
    });

    revalidatePath("/quotations");
    return {
      quotationNumber: quotation.quotationNumber,
      id: quotation.id,
    };
  });
}
