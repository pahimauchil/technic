"use server";

import { revalidatePath } from "next/cache";

import { runAction, BusinessRuleError } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { sessionAccessMode } from "@/lib/access-mode";
import { createInvoice, type SaleLineInput } from "@/lib/services/sales";

export interface CheckoutInput {
  customerId: string;
  lines: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    gstRate?: number;
    serialNumbers?: string[];
  }[];
  paymentAmount?: number;
  paymentMethod?: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  notes?: string;
}

/**
 * The access-mode gate for billing. The client never chooses the invoice kind:
 * the mode comes from the server session, and requesting a GST sale while the
 * session is NON_GST is rejected here with 403-equivalent semantics.
 */
export async function checkoutAction(input: CheckoutInput) {
  return runAction(async () => {
    const user = await authorize("invoice.create");
    const firmId = requireFirmId(user);
    const mode = sessionAccessMode(user);

    if (input.lines.length === 0) {
      throw new BusinessRuleError("Add at least one item before checkout");
    }

    const invoice = await createInvoice({
      firmId,
      branchId: user.branchId ?? "",
      customerId: input.customerId,
      taxMode: mode,
      lines: input.lines as SaleLineInput[],
      paymentAmount: input.paymentAmount && input.paymentAmount > 0 ? input.paymentAmount : undefined,
      paymentMethod: input.paymentMethod,
      notes: input.notes ?? null,
      userId: user.id,
    });

    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber };
  });
}
