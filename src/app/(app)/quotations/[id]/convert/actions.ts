"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { sessionAccessMode } from "@/lib/access-mode";
import { convertQuotationToInvoice } from "@/lib/services/sales";

export async function convertQuotationAction(input: {
  quotationId: string;
  customerId: string;
  paymentAmount?: number;
  paymentMethod?: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
}) {
  return runAction(async () => {
    const user = await authorize("quotation.convert");
    const firmId = requireFirmId(user);

    const invoice = await convertQuotationToInvoice(firmId, input.quotationId, {
      taxMode: sessionAccessMode(user),
      paymentAmount: input.paymentAmount,
      paymentMethod: input.paymentMethod,
      userId: user.id,
    });

    revalidatePath("/invoices");
    revalidatePath("/quotations");
    return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber };
  });
}
