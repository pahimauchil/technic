import "server-only";

import { prisma } from "@/lib/prisma";
import { prisma as db } from "@/lib/prisma";
import type { TaxMode } from "@/generated/prisma/enums";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { computeTaxSummary, isSameState, sellerStateFor } from "@/lib/tax";
import { nextDocumentNumber, DOCUMENT_TYPES, financialYearFor } from "@/lib/sequence";
import { recordAudit, modeLabel } from "@/lib/audit";
import {
  assertSerialsAvailableForSale,
  requireProduct,
  transitionSerialUnits,
  writeStockTransaction,
} from "@/lib/services/inventory";
import { round2 } from "@/lib/money";

/**
 * Sales service: quotations → sales orders → invoices. Invoice creation follows
 * the handover's business-rule order (validate customer → products → variants →
 * stock → serials → access mode → calculate → number → create → stock txns →
 * mark serials → payment → audit) inside one transaction.
 */

export interface SaleLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  gstRate?: number;
  serialNumbers?: string[];
  descriptionOverride?: string;
}

export interface QuotationInput {
  firmId: string;
  branchId: string;
  customerId: string;
  taxMode: TaxMode;
  quotationDate?: Date;
  validUntil?: Date | null;
  notes?: string | null;
  terms?: string | null;
  lines: SaleLineInput[];
  userId?: string | null;
}

const round = round2;

function lineDescription(
  product: { name: string; sku: string },
  variant: { name: string } | null | undefined,
): string {
  return variant ? `${product.name} — ${variant.name}` : product.name;
}

async function buildLinesWithTax(
  lines: SaleLineInput[],
  mode: TaxMode,
  sameState: boolean,
) {
  if (lines.length === 0) throw new BusinessRuleError("Add at least one line item");
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { variants: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const enriched = lines.map((line) => {
    const product = productMap.get(line.productId);
    if (!product) throw new NotFoundError("Product not found");
    const variant = line.variantId
      ? product.variants.find((v) => v.id === line.variantId)
      : null;
    if (line.variantId && !variant) throw new NotFoundError("Product variant not found");
    if (line.quantity <= 0) throw new BusinessRuleError("Quantity must be greater than zero");
    if (line.unitPrice < 0) throw new BusinessRuleError("Price cannot be negative");
    return { line, product, variant };
  });

  const summary = computeTaxSummary(
    enriched.map(({ line }) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? 0,
      gstRate: mode === "GST" ? (line.gstRate ?? 0) : 0,
    })),
    { mode, sameState },
  );

  return { enriched, summary };
}

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

export async function createQuotation(input: QuotationInput) {
  const sameState = isSameState(null, null); // quotations are indicative only
  const { enriched, summary } = await buildLinesWithTax(input.lines, input.taxMode, sameState);

  const quotationNumber = await nextDocumentNumber(
    input.firmId,
    DOCUMENT_TYPES.QUOTATION,
    "NON_GST",
  );

  return prisma.$transaction(async (tx) => {
    const quotation = await tx.quotation.create({
      data: {
        quotationNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        customerId: input.customerId,
        taxMode: input.taxMode,
        quotationDate: input.quotationDate ?? new Date(),
        validUntil: input.validUntil ?? null,
        subtotal: summary.subtotal,
        discountAmount: summary.discountAmount,
        taxableAmount: summary.taxableAmount,
        cgstAmount: summary.cgstAmount,
        sgstAmount: summary.sgstAmount,
        igstAmount: summary.igstAmount,
        totalAmount: summary.totalAmount,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        createdById: input.userId ?? null,
        status: "DRAFT",
        lines: {
          create: enriched.map(({ line, product, variant }, index) => ({
            productId: product.id,
            variantId: variant?.id ?? null,
            description: line.descriptionOverride ?? lineDescription(product, variant),
            hsnCode: product.hsnCode,
            quantity: line.quantity,
            unitPrice: round(line.unitPrice),
            discountPercent: line.discountPercent ?? 0,
            gstRate: input.taxMode === "GST" ? (line.gstRate ?? 0) : 0,
            lineTotal: summary.lines[index].lineTotal,
            serialNumbers: line.serialNumbers,
          })),
        },
      },
    });

    await recordAudit({
      action: "QUOTATION_CREATED",
      entity: "Quotation",
      entityId: quotation.id,
      summary: `${quotation.quotationNumber} (${modeLabel(input.taxMode)})`,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
      after: { total: Number(quotation.totalAmount) },
    });

    return quotation;
  });
}

export async function updateQuotationStatus(
  firmId: string,
  quotationId: string,
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED",
  userId?: string | null,
) {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, firmId },
  });
  if (!quotation) throw new NotFoundError("Quotation not found");
  if (quotation.status === "CONVERTED") {
    throw new BusinessRuleError("A converted quotation cannot be changed");
  }
  return prisma.quotation.update({
    where: { id: quotationId },
    data: { status },
  });
}

// ---------------------------------------------------------------------------
// Sales orders
// ---------------------------------------------------------------------------

export async function createSalesOrder(
  input: QuotationInput & { quotationId?: string | null },
) {
  const sameState = true; // resolved again at invoice time
  const { enriched, summary } = await buildLinesWithTax(input.lines, input.taxMode, sameState);
  const orderNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.SALES_ORDER, "NON_GST");

  return prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.create({
      data: {
        orderNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        customerId: input.customerId,
        quotationId: input.quotationId ?? null,
        taxMode: input.taxMode,
        status: "CONFIRMED",
        orderDate: new Date(),
        expectedDate: input.validUntil ?? null,
        subtotal: summary.subtotal,
        discountAmount: summary.discountAmount,
        taxableAmount: summary.taxableAmount,
        cgstAmount: summary.cgstAmount,
        sgstAmount: summary.sgstAmount,
        igstAmount: summary.igstAmount,
        totalAmount: summary.totalAmount,
        notes: input.notes ?? null,
        createdById: input.userId ?? null,
        lines: {
          create: enriched.map(({ line, product, variant }, index) => ({
            productId: product.id,
            variantId: variant?.id ?? null,
            description: line.descriptionOverride ?? lineDescription(product, variant),
            hsnCode: product.hsnCode,
            quantity: line.quantity,
            unitPrice: round(line.unitPrice),
            discountPercent: line.discountPercent ?? 0,
            gstRate: input.taxMode === "GST" ? (line.gstRate ?? 0) : 0,
            lineTotal: summary.lines[index].lineTotal,
          })),
        },
      },
    });

    await recordAudit({
      action: "SALE_CREATED",
      entity: "SalesOrder",
      entityId: order.id,
      summary: orderNumber,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
    });

    return order;
  });
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export interface InvoiceInput {
  firmId: string;
  branchId: string;
  customerId: string;
  /** Must match the session's access mode — enforced by the caller. */
  taxMode: TaxMode;
  lines: SaleLineInput[];
  quotationId?: string | null;
  salesOrderId?: string | null;
  invoiceDate?: Date;
  dueDate?: Date | null;
  notes?: string | null;
  terms?: string | null;
  /** Immediate payment, if any. */
  paymentAmount?: number;
  paymentMethod?: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  userId?: string | null;
}

/**
 * Creates an invoice. In GST mode this is a Tax Invoice (CGST/SGST or IGST
 * from seller state vs place of supply); in NON_GST mode every tax field stays
 * zero and the document is a plain Bill. Stock moves and serials are stamped
 * in the same transaction.
 */
export async function createInvoice(input: InvoiceInput) {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, firmId: input.firmId },
  });
  if (!customer) throw new NotFoundError("Customer not found");
  if (Number(customer.creditLimit) > 0) {
    const outstanding = Number(customer.outstandingAmount) + (input.paymentAmount ? 0 : 0);
    // credit check happens against current outstanding after this invoice
    const wouldBe = outstanding + (await previewInvoiceTotal(input));
    if (wouldBe > Number(customer.creditLimit)) {
      throw new BusinessRuleError(
        `Credit limit exceeded: this invoice would take the balance to ${wouldBe.toFixed(2)} against a limit of ${Number(customer.creditLimit).toFixed(2)}.`,
      );
    }
  }

  const sellerState = await sellerStateFor(input.firmId, input.branchId);
  const supplyState = input.taxMode === "GST" ? (customer.state ?? customer.city ?? null) : null;
  const sameState = isSameState(sellerState, supplyState);

  const { enriched, summary } = await buildLinesWithTax(input.lines, input.taxMode, sameState);

  // Serial validation before anything is written.
  for (const { line, product } of enriched) {
    if (product.trackSerials) {
      const serials = line.serialNumbers ?? [];
      if (serials.filter((s) => s.trim()).length !== line.quantity) {
        throw new BusinessRuleError(
          `${product.name} requires ${line.quantity} serial number${line.quantity === 1 ? "" : "s"}`,
        );
      }
      await assertSerialsAvailableForSale(input.firmId, product.id, input.branchId, serials);
    }
  }

  // Stock validation for non-serialized lines happens inside writeStockTransaction
  // (it refuses to drive the balance below zero) — but we pre-check so the whole
  // invoice can fail before any write.
  for (const { line, product } of enriched) {
    if (product.trackSerials) continue;
    const { getStockLevel } = await import("@/lib/services/inventory");
    const available = await getStockLevel(input.firmId, input.branchId, {
      productId: product.id,
      variantId: line.variantId ?? null,
    });
    if (available < line.quantity) {
      throw new BusinessRuleError(
        `Insufficient stock for ${product.name}: ${available} available, ${line.quantity} requested`,
      );
    }
  }

  const invoiceNumber = await nextDocumentNumber(
    input.firmId,
    DOCUMENT_TYPES.INVOICE,
    input.taxMode,
    prisma,
    input.invoiceDate ?? new Date(),
  );
  const financialYear = financialYearFor(input.invoiceDate ?? new Date());

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        kind: input.taxMode === "GST" ? "TAX_INVOICE" : "NON_GST_BILL",
        firmId: input.firmId,
        branchId: input.branchId,
        customerId: customer.id,
        taxMode: input.taxMode,
        financialYear,
        status: "ISSUED",
        billToName: customer.name,
        billToPhone: customer.phone,
        billToEmail: customer.email,
        billToAddress: [customer.addressLine, customer.city, customer.state, customer.pincode]
          .filter(Boolean)
          .join(", ") || null,
        billToGstin: customer.gstin,
        placeOfSupply: supplyState,
        quotationId: input.quotationId ?? null,
        salesOrderId: input.salesOrderId ?? null,
        invoiceDate: input.invoiceDate ?? new Date(),
        dueDate: input.dueDate ?? null,
        subtotal: summary.subtotal,
        discountAmount: summary.discountAmount,
        taxableAmount: summary.taxableAmount,
        cgstAmount: summary.cgstAmount,
        sgstAmount: summary.sgstAmount,
        igstAmount: summary.igstAmount,
        roundOff: summary.roundOff,
        totalAmount: summary.totalAmount,
        amountPaid: 0,
        amountDue: summary.totalAmount,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        createdById: input.userId ?? null,
        lines: {
          create: enriched.map(({ line, product, variant }, index) => ({
            productId: product.id,
            variantId: variant?.id ?? null,
            description: line.descriptionOverride ?? lineDescription(product, variant),
            hsnCode: product.hsnCode,
            serialNumbers: (line.serialNumbers ?? []).filter(Boolean).join("\n") || null,
            quantity: line.quantity,
            unitPrice: round(line.unitPrice),
            discountPercent: line.discountPercent ?? 0,
            gstRate: input.taxMode === "GST" ? (line.gstRate ?? 0) : 0,
            taxableValue: summary.lines[index].taxableValue,
            cgstAmount: summary.lines[index].cgst,
            sgstAmount: summary.lines[index].sgst,
            igstAmount: summary.lines[index].igst,
            lineTotal: summary.lines[index].lineTotal,
          })),
        },
      },
      include: { lines: true },
    });

    // Stock + serials per line.
    for (const [index, { line, product }] of enriched.entries()) {
      await writeStockTransaction(tx, {
        firmId: input.firmId,
        branchId: input.branchId,
        productId: product.id,
        variantId: line.variantId ?? null,
        type: "SALE_OUT",
        quantity: -line.quantity,
        unitCost: Number(product.purchasePrice) || null,
        reference: invoiceNumber,
        documentType: "INVOICE",
        documentId: invoice.id,
        userId: input.userId ?? null,
      });

      if (product.trackSerials) {
        const units = await tx.serialUnit.findMany({
          where: {
            firmId: input.firmId,
            serialNumber: { in: (line.serialNumbers ?? []).filter(Boolean) },
          },
          select: { id: true, sellingPrice: true },
        });
        await transitionSerialUnits(tx, {
          firmId: input.firmId,
          serialUnitIds: units.map((u) => u.id),
          eventType: "SOLD",
          toStatus: "SOLD",
          reference: invoiceNumber,
          documentId: invoice.id,
          userId: input.userId ?? null,
        });
        for (const unit of units) {
          await tx.serialUnit.update({
            where: { id: unit.id },
            data: {
              soldInvoiceId: invoice.id,
              soldInvoiceLineId: invoice.lines[index].id,
              sellingPrice: round(line.unitPrice),
              soldAt: input.invoiceDate ?? new Date(),
            },
          });
          // Warranty record per the product's warranty months.
          if (product.warrantyMonths > 0) {
            const start = input.invoiceDate ?? new Date();
            const end = new Date(start);
            end.setMonth(end.getMonth() + product.warrantyMonths);
            await tx.warranty.create({
              data: {
                firmId: input.firmId,
                productId: product.id,
                serialUnitId: unit.id,
                customerId: customer.id,
                invoiceId: invoice.id,
                branchId: input.branchId,
                serialNumber: null,
                warrantyStart: start,
                warrantyEnd: end,
                warrantyMonths: product.warrantyMonths,
                warrantyType: product.warrantyType,
                status: "ACTIVE",
              },
            });
          }
        }
      }
    }

    // Immediate payment.
    if (input.paymentAmount && input.paymentAmount > 0) {
      const paymentNumber = await nextDocumentNumber(
        input.firmId,
        DOCUMENT_TYPES.PAYMENT,
        "NON_GST",
        tx,
      );
      const amount = Math.min(input.paymentAmount, summary.totalAmount);
      await tx.payment.create({
        data: {
          paymentNumber,
          firmId: input.firmId,
          branchId: input.branchId,
          direction: "CUSTOMER_IN",
          status: "PAID",
          customerId: customer.id,
          invoiceId: invoice.id,
          amount,
          method: input.paymentMethod ?? "CASH",
          paidAt: new Date(),
          receivedById: input.userId ?? null,
        },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: amount,
          amountDue: round(summary.totalAmount - amount),
          status: amount >= summary.totalAmount ? "PAID" : "PARTIALLY_PAID",
        },
      });
    }

    // Mark quotation converted.
    if (input.quotationId) {
      await tx.quotation.update({
        where: { id: input.quotationId },
        data: { status: "CONVERTED", convertedAt: new Date() },
      });
    }
    if (input.salesOrderId) {
      await tx.salesOrder.update({
        where: { id: input.salesOrderId },
        data: { status: "INVOICED" },
      });
    }

    // Customer rollup.
    await recalcCustomerRollup(tx, input.firmId, customer.id);

    await recordAudit({
      action: "INVOICE_CREATED",
      entity: "Invoice",
      entityId: invoice.id,
      summary: `${invoiceNumber} (${input.taxMode === "GST" ? "Tax Invoice" : "Bill"})`,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
      after: {
        total: Number(invoice.totalAmount),
        tax: {
          cgst: Number(invoice.cgstAmount),
          sgst: Number(invoice.sgstAmount),
          igst: Number(invoice.igstAmount),
        },
      },
    });

    return invoice;
  });
}

async function previewInvoiceTotal(input: InvoiceInput): Promise<number> {
  const lines = input.lines.map((l) => ({
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPercent: l.discountPercent ?? 0,
    gstRate: input.taxMode === "GST" ? (l.gstRate ?? 0) : 0,
  }));
  const summary = computeTaxSummary(lines, { mode: input.taxMode, sameState: true });
  return summary.totalAmount;
}

/** Outstanding = billed − received, including opening balances. */
export async function recalcCustomerRollup(
  tx: { customer: { findUnique: Function; update: Function } },
  firmId: string,
  customerId: string,
): Promise<void> {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    include: {
      invoices: { where: { firmId, status: { not: "CANCELLED" } }, select: { totalAmount: true } },
      payments: { where: { firmId, direction: "CUSTOMER_IN" }, select: { amount: true } },
      salesReturns: { where: { firmId, status: "APPROVED" }, select: { totalAmount: true } },
    },
  });
  if (!customer) return;

  const totalBilled = customer.invoices.reduce((sum: number, inv: { totalAmount: unknown }) => sum + Number(inv.totalAmount), 0);
  const paid = customer.payments.reduce((sum: number, pay: { amount: unknown }) => sum + Number(pay.amount), 0);
  const returned = customer.salesReturns.reduce((sum: number, ret: { totalAmount: unknown }) => sum + Number(ret.totalAmount), 0);
  const outstanding = Math.max(0, round2(totalBilled - paid - returned + Number(customer.openingBalance)));

  await tx.customer.update({
    where: { id: customerId },
    data: {
      invoiceCount: customer.invoices.length,
      totalBilled: round2(totalBilled),
      outstandingAmount: outstanding,
      lastInvoiceAt: customer.invoices.length > 0 ? new Date() : undefined,
    },
  });
}

/** Cancellation restores stock, releases serials and reverses the rollup. */
export async function cancelInvoice(
  firmId: string,
  invoiceId: string,
  reason: string,
  userId?: string | null,
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, firmId },
    include: { lines: true, payments: true },
  });
  if (!invoice) throw new NotFoundError("Invoice not found");
  if (invoice.status === "CANCELLED") {
    throw new BusinessRuleError("This invoice is already cancelled");
  }

  return prisma.$transaction(async (tx) => {
    for (const line of invoice.lines) {
      await writeStockTransaction(tx, {
        firmId,
        branchId: invoice.branchId,
        productId: line.productId,
        variantId: line.variantId,
        type: "SALE_RETURN_IN",
        quantity: line.quantity,
        reference: invoice.invoiceNumber,
        documentType: "INVOICE_CANCEL",
        documentId: invoice.id,
        notes: "Invoice cancelled — stock restored",
        userId: userId ?? null,
      });
      if (line.serialNumbers) {
        const serials = line.serialNumbers.split("\n").filter(Boolean);
        const units = await tx.serialUnit.findMany({
          where: { firmId, serialNumber: { in: serials } },
          select: { id: true },
        });
        await transitionSerialUnits(tx, {
          firmId,
          serialUnitIds: units.map((u) => u.id),
          eventType: "SALE_RETURNED",
          toStatus: "RETURNED",
          reference: invoice.invoiceNumber,
          note: "Invoice cancelled",
          userId: userId ?? null,
        });
      }
    }

    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });

    await recalcCustomerRollup(tx, firmId, invoice.customerId);

    await recordAudit({
      action: "INVOICE_CANCELLED",
      entity: "Invoice",
      entityId: invoice.id,
      summary: `${invoice.invoiceNumber}: ${reason}`,
      firmId,
      branchId: invoice.branchId,
      userId,
      before: { status: invoice.status },
      after: { status: "CANCELLED" },
    });

    return updated;
  });
}

export async function getInvoiceForView(
  firmId: string,
  invoiceId: string,
  options: { taxMode?: TaxMode } = {},
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, firmId, ...(options.taxMode ? { taxMode: options.taxMode } : {}) },
    include: {
      customer: true,
      branch: true,
      lines: {
        include: {
          product: { select: { name: true, sku: true, hsnCode: true } },
          variant: { select: { name: true, sku: true } },
        },
      },
      payments: { orderBy: { paidAt: "asc" } },
      createdBy: { select: { name: true } },
      quotation: { select: { quotationNumber: true } },
      salesOrder: { select: { orderNumber: true } },
    },
  });
  if (!invoice) throw new NotFoundError("Invoice not found");
  return invoice;
}

/** Quote → invoice conversion using the quotation's own lines. */
export async function convertQuotationToInvoice(
  firmId: string,
  quotationId: string,
  options: { taxMode: TaxMode; paymentAmount?: number; paymentMethod?: InvoiceInput["paymentMethod"]; userId?: string | null },
) {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, firmId },
    include: { lines: true },
  });
  if (!quotation) throw new NotFoundError("Quotation not found");
  if (quotation.status === "CONVERTED") {
    throw new BusinessRuleError("This quotation has already been converted");
  }

  return createInvoice({
    firmId,
    branchId: quotation.branchId,
    customerId: quotation.customerId,
    taxMode: options.taxMode,
    quotationId: quotation.id,
    notes: quotation.notes,
    terms: quotation.terms,
    paymentAmount: options.paymentAmount,
    paymentMethod: options.paymentMethod,
    userId: options.userId,
    lines: quotation.lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: Number(line.unitPrice),
      discountPercent: Number(line.discountPercent),
      gstRate: Number(line.gstRate),
      serialNumbers: line.serialNumbers,
    })),
  });
}

export { db };
