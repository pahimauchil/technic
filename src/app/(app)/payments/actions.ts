"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { recordCustomerPayment } from "@/lib/services/payments";

export async function recordPaymentAction(input: {
  customerId: string;
  amount: number;
  method: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  invoiceId?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize("payments.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    const payment = await recordCustomerPayment({
      firmId,
      branchId,
      customerId: input.customerId,
      invoiceId: input.invoiceId ?? null,
      amount: input.amount,
      method: input.method,
      userId: user.id,
    });

    revalidatePath("/payments");
    revalidatePath("/customers");
    return { paymentNumber: payment.paymentNumber };
  });
}
