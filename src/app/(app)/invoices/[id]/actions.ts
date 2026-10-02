"use server";

import { revalidatePath } from "next/cache";

import { runAction, NotFoundError } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch, taxModeWhere } from "@/lib/session";
import { recordCustomerPayment, createSalesReturn } from "@/lib/services/payments";
import { cancelInvoice } from "@/lib/services/sales";
import { prisma } from "@/lib/prisma";

export async function cancelInvoiceAction(input: { invoiceId: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("invoice.cancel");
    if (!user.activeFirmId) throw new Error("Select a firm first");
    // View isolation: a GST_ONLY session may only touch GST invoices.
    const visible = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, firmId: user.activeFirmId, ...taxModeWhere(user) },
      select: { id: true },
    });
    if (!visible) throw new NotFoundError("Invoice not found");
    await cancelInvoice(user.activeFirmId, input.invoiceId, input.reason.trim(), user.id);
    return { cancelled: true };
  });
}

export async function recordInvoicePaymentAction(input: {
  invoiceId: string;
  amount: number;
  method: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
}) {
  return runAction(async () => {
    const user = await authorize("payments.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    const invoice = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, firmId, ...taxModeWhere(user) },
      select: { customerId: true },
    });
    if (!invoice) {
      const { NotFoundError } = await import("@/lib/action-result");
      throw new NotFoundError("Invoice not found");
    }

    const payment = await recordCustomerPayment({
      firmId,
      branchId,
      customerId: invoice.customerId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      method: input.method,
      userId: user.id,
    });

    revalidatePath(`/invoices/${input.invoiceId}`);
    revalidatePath("/invoices");
    revalidatePath("/payments");
    revalidatePath("/customers");
    return { paymentNumber: payment.paymentNumber };
  });
}

export async function createSalesReturnAction(input: {
  invoiceId: string;
  reason: string;
  refundMethod: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  lines: { invoiceLineId: string; quantity: number; serialNumbers?: string[] }[];
}) {
  return runAction(async () => {
    const user = await authorize("sales_return.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    // View isolation: returns can only be raised against invoices in view.
    const visible = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, firmId, ...taxModeWhere(user) },
      select: { id: true },
    });
    if (!visible) throw new NotFoundError("Invoice not found");

    const returnDoc = await createSalesReturn({
      firmId,
      branchId,
      invoiceId: input.invoiceId,
      reason: input.reason.trim(),
      refundMethod: input.refundMethod,
      lines: input.lines,
      userId: user.id,
    });

    revalidatePath(`/invoices/${input.invoiceId}`);
    revalidatePath("/sales-returns");
    return { returnNumber: returnDoc.returnNumber };
  });
}
