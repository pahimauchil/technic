import "server-only";

import { prisma } from "@/lib/prisma";
import { formatCurrency, amountInWords, num } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  getCompanyProfile,
  PDFDocumentBuilder,
  type BranchProfile,
  type PDFTableColumn,
  type PDFTableRow,
  type SummaryLine,
} from "./pdf-builder";

/**
 * Technic Technologies document templates. One generator per business
 * document, all assembled from the shared PDFDocumentBuilder blocks:
 *  - Tax Invoice / Bill, keyed on invoice.kind
 *  - Quotation
 *  - Purchase Order
 *  - Purchase Invoice (supplier bill)
 *  - Payment Receipt (customer receipt)
 *  - Expense Voucher
 */

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

function branchProfile(branch: {
  name: string;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
} | null | undefined): BranchProfile {
  return {
    name: branch?.name || "Head Office",
    addressLine: branch?.addressLine,
    city: branch?.city,
    state: branch?.state,
    pincode: branch?.pincode,
    phone: branch?.phone,
    email: branch?.email,
  };
}

function serialSuffix(serialNumbers: string[] | string | null): string {
  if (!serialNumbers) return "";
  const serials = Array.isArray(serialNumbers)
    ? serialNumbers.filter(Boolean)
    : serialNumbers.split("\n").filter(Boolean);
  if (serials.length === 0) return "";
  return `\nSN: ${serials.join(", ")}`;
}

type Numericish = number | string | { toNumber: () => number };

interface LineLike {
  description: string;
  hsnCode?: string | null;
  serialNumbers?: string[] | string | null;
  quantity: Numericish;
  unitPrice: Numericish;
  discountPercent?: Numericish;
  gstRate?: Numericish;
  taxableValue?: Numericish;
  cgstAmount?: Numericish | null;
  sgstAmount?: Numericish | null;
  igstAmount?: Numericish | null;
  lineTotal: Numericish;
}

interface TaxTotals {
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}

/**
 * The line-items table. GST documents expose taxable value + CGST/SGST/IGST
 * columns per the tax-invoice format; bills omit the tax columns.
 */
function invoiceTableRows(lines: LineLike[], withTaxColumns: boolean) {
  let totalQty = 0;
  const rows: PDFTableRow[] = lines.map((line, idx) => {
    const qty = typeof line.quantity === "number" ? line.quantity : (typeof line.quantity === "string" ? Number(line.quantity) : line.quantity.toNumber());
    totalQty += qty;
    const serials = serialSuffix(line.serialNumbers ?? null);
    const unitPrice = typeof line.unitPrice === "number" ? line.unitPrice : (typeof line.unitPrice === "string" ? Number(line.unitPrice) : line.unitPrice.toNumber());
    const lineTotal = typeof line.lineTotal === "number" ? line.lineTotal : (typeof line.lineTotal === "string" ? Number(line.lineTotal) : line.lineTotal.toNumber());
    const rate = formatCurrency(unitPrice);
    const amount = formatCurrency(lineTotal);
    const base: PDFTableRow = {
      sl: idx + 1,
      item: `${line.description}${serials}`,
      hsn: line.hsnCode || "—",
      qty,
      rate,
      amount,
    };
    if (withTaxColumns) {
      return {
        ...base,
        disc: `${num(line.discountPercent as number)}%`,
        taxable: formatCurrency(num((line.taxableValue ?? line.lineTotal) as number)),
        gst: formatCurrency(
          num((line.cgstAmount ?? 0) as number) +
            num((line.sgstAmount ?? 0) as number) +
            num((line.igstAmount ?? 0) as number),
        ),
      };
    }
    return base;
  });

  return { rows, totalQty };
}

function taxInvoiceColumns(): PDFTableColumn[] {
  return [
    { id: "sl", header: "#", width: 4, align: "center" },
    { id: "item", header: "Item", width: 28 },
    { id: "hsn", header: "HSN", width: 9, align: "center" },
    { id: "qty", header: "Qty", width: 5, align: "center" },
    { id: "rate", header: "Rate", width: 11, align: "right" },
    { id: "disc", header: "Disc", width: 6, align: "center" },
    { id: "taxable", header: "Taxable", width: 12, align: "right" },
    { id: "gst", header: "GST", width: 10, align: "right" },
    { id: "amount", header: "Amount", width: 15, align: "right" },
  ];
}

function simpleInvoiceColumns(): PDFTableColumn[] {
  return [
    { id: "sl", header: "#", width: 5, align: "center" },
    { id: "item", header: "Item", width: 44 },
    { id: "hsn", header: "HSN", width: 10, align: "center" },
    { id: "qty", header: "Qty", width: 7, align: "center" },
    { id: "rate", header: "Rate", width: 14, align: "right" },
    { id: "amount", header: "Amount", width: 20, align: "right" },
  ];
}

// ---------------------------------------------------------------------------
// Sales invoice: TAX_INVOICE (GST) or NON_GST_BILL
// ---------------------------------------------------------------------------

export async function generateInvoicePDF(invoiceId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      branch: true,
      lines: true,
      createdBy: { select: { name: true } },
      salesOrder: { select: { orderNumber: true } },
      quotation: { select: { quotationNumber: true } },
    },
  });

  if (!invoice) throw new Error(`Invoice #${invoiceId} not found.`);

  const isTaxInvoice = invoice.kind === "TAX_INVOICE";
  const company = await getCompanyProfile(invoice.firmId);
  const builder = new PDFDocumentBuilder(company);

  builder.renderCompanyHeader(branchProfile(invoice.branch));
  builder.renderDocumentTitle(isTaxInvoice ? "Tax Invoice" : "Bill of Supply");

  const placeOfSupply = invoice.placeOfSupply || invoice.customer?.state || "—";

  builder.renderInfoColumns([
    {
      heading: "Bill To",
      lines: [
        invoice.billToName,
        ...(invoice.billToAddress ? [invoice.billToAddress] : []),
        ...(invoice.billToGstin ? [`GSTIN: ${invoice.billToGstin}`] : []),
        `Ph: ${invoice.billToPhone || "—"}`,
      ],
    },
    {
      heading: "Invoice Details",
      lines: [
        invoice.invoiceNumber,
        `Date: ${formatDate(invoice.invoiceDate)}`,
        `Place of Supply: ${placeOfSupply}`,
        ...(invoice.salesOrder ? [`SO: ${invoice.salesOrder.orderNumber}`] : []),
        ...(invoice.quotation ? [`Quote: ${invoice.quotation.quotationNumber}`] : []),
      ],
    },
    {
      heading: isTaxInvoice ? "Tax Details" : "Details",
      lines: isTaxInvoice
        ? [
            `Mode: Intra-state (CGST+SGST)`,
            `vs Inter-state (IGST)`,
            `Supplier: ${company.name}`,
          ]
        : [`Supplier: ${company.name}`],
    },
  ]);

  const { rows, totalQty } = invoiceTableRows(invoice.lines, isTaxInvoice);

  const totals: TaxTotals = {
    taxableAmount: num(invoice.taxableAmount),
    cgstAmount: num(invoice.cgstAmount),
    sgstAmount: num(invoice.sgstAmount),
    igstAmount: num(invoice.igstAmount),
  };

  const totalRow: PDFTableRow = isTaxInvoice
    ? { sl: "", item: "TOTAL", hsn: "", qty: totalQty, rate: "", disc: "", taxable: formatCurrency(totals.taxableAmount), gst: formatCurrency(totals.cgstAmount + totals.sgstAmount + totals.igstAmount), amount: formatCurrency(invoice.totalAmount) }
    : { sl: "", item: "TOTAL", hsn: "", qty: totalQty, rate: "", amount: formatCurrency(invoice.totalAmount) };

  builder.renderItemsTable(
    isTaxInvoice ? taxInvoiceColumns() : simpleInvoiceColumns(),
    rows,
    totalRow,
  );

  const summaryLines: SummaryLine[] = [{ label: "Sub Total", value: formatCurrency(invoice.subtotal) }];
  if (num(invoice.discountAmount) > 0) {
    summaryLines.push({ label: "Discount", value: `-${formatCurrency(invoice.discountAmount)}` });
  }
  if (isTaxInvoice) {
    summaryLines.push({ label: "Taxable Value", value: formatCurrency(totals.taxableAmount) });
    if (totals.cgstAmount > 0) summaryLines.push({ label: "CGST", value: formatCurrency(totals.cgstAmount) });
    if (totals.sgstAmount > 0) summaryLines.push({ label: "SGST", value: formatCurrency(totals.sgstAmount) });
    if (totals.igstAmount > 0) summaryLines.push({ label: "IGST", value: formatCurrency(totals.igstAmount) });
    if (num(invoice.roundOff) !== 0) {
      summaryLines.push({ label: "Round Off", value: formatCurrency(invoice.roundOff) });
    }
  }
  summaryLines.push(
    { label: "TOTAL", value: formatCurrency(invoice.totalAmount), highlight: true },
    { label: "Received", value: formatCurrency(invoice.amountPaid) },
    { label: "Balance Due", value: formatCurrency(invoice.amountDue), bold: true },
  );

  builder.renderFinancialSummary({
    amountWordsLabel: "Amount In Words",
    amountWords: amountInWords(invoice.totalAmount),
    terms: invoice.terms || company.termsConditions,
    lines: summaryLines,
    bankDetails: company.bankDetails || undefined,
  });

  if (invoice.status === "CANCELLED") {
    builder.renderCancelledStamp(invoice.cancellationReason || "This invoice has been cancelled");
  }

  builder.renderSignatureBlock([{ title: `For ${company.name}`, name: invoice.createdBy?.name }]);

  const buffer = await builder.build();
  const kindLabel = isTaxInvoice ? "Tax-Invoice" : "Bill";
  return { buffer, fileName: `TECHNIC-${kindLabel}-${invoice.invoiceNumber.replace(/\//g, "-")}.pdf` };
}

// ---------------------------------------------------------------------------
// Quotation
// ---------------------------------------------------------------------------

export async function generateQuotationPDF(quotationId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      customer: true,
      branch: true,
      lines: true,
      createdBy: { select: { name: true } },
    },
  });

  if (!quotation) throw new Error(`Quotation #${quotationId} not found.`);

  const company = await getCompanyProfile(quotation.firmId);
  const builder = new PDFDocumentBuilder(company);

  builder.renderCompanyHeader(branchProfile(quotation.branch));
  builder.renderDocumentTitle("Quotation");

  builder.renderInfoColumns([
    {
      heading: "Quotation For",
      lines: [
        quotation.customer.name,
        `Ph: ${quotation.customer.phone}`,
        ...(quotation.customer.gstin ? [`GSTIN: ${quotation.customer.gstin}`] : []),
      ],
    },
    {
      heading: "Quotation Details",
      lines: [
        quotation.quotationNumber,
        `Date: ${formatDate(quotation.quotationDate)}`,
        ...(quotation.validUntil ? [`Valid Until: ${formatDate(quotation.validUntil)}`] : []),
        `Status: ${quotation.status}`,
      ],
    },
  ]);

  const isGst = quotation.taxMode === "GST";
  const { rows, totalQty } = invoiceTableRows(quotation.lines, isGst);

  builder.renderItemsTable(
    isGst ? taxInvoiceColumns() : simpleInvoiceColumns(),
    rows,
    isGst
      ? { sl: "", item: "TOTAL", hsn: "", qty: totalQty, rate: "", disc: "", taxable: formatCurrency(quotation.taxableAmount), gst: formatCurrency(num(quotation.cgstAmount) + num(quotation.sgstAmount) + num(quotation.igstAmount)), amount: formatCurrency(quotation.totalAmount) }
      : { sl: "", item: "TOTAL", hsn: "", qty: totalQty, rate: "", amount: formatCurrency(quotation.totalAmount) },
  );

  const summaryLines: SummaryLine[] = [{ label: "Sub Total", value: formatCurrency(quotation.subtotal) }];
  if (num(quotation.discountAmount) > 0) {
    summaryLines.push({ label: "Discount", value: `-${formatCurrency(quotation.discountAmount)}` });
  }
  summaryLines.push({ label: "TOTAL", value: formatCurrency(quotation.totalAmount), highlight: true });

  builder.renderFinancialSummary({
    amountWordsLabel: "Amount In Words",
    amountWords: amountInWords(quotation.totalAmount),
    terms: quotation.terms || company.termsConditions,
    lines: summaryLines,
    bankDetails: company.bankDetails || undefined,
  });

  builder.renderSignatureBlock([{ title: `For ${company.name}`, name: quotation.createdBy?.name }]);

  const buffer = await builder.build();
  return { buffer, fileName: `TECHNIC-Quotation-${quotation.quotationNumber.replace(/\//g, "-")}.pdf` };
}

// ---------------------------------------------------------------------------
// Purchase order
// ---------------------------------------------------------------------------

export async function generatePurchaseOrderPDF(poId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      supplier: true,
      branch: true,
      items: true,
      createdBy: { select: { name: true } },
    },
  });

  if (!po) throw new Error(`Purchase order #${poId} not found.`);

  const company = await getCompanyProfile(po.firmId);
  const builder = new PDFDocumentBuilder(company);

  builder.renderCompanyHeader(branchProfile(po.branch));
  builder.renderDocumentTitle("Purchase Order");

  builder.renderInfoColumns([
    {
      heading: "Supplier",
      lines: [
        po.supplier.name,
        ...(po.supplier.gstin ? [`GSTIN: ${po.supplier.gstin}`] : []),
        `Ph: ${po.supplier.phone || "—"}`,
      ],
    },
    {
      heading: "Delivery To",
      lines: [po.branch.name, po.branch.city || company.address],
    },
    {
      heading: "Order Details",
      lines: [
        po.poNumber,
        `Date: ${formatDate(po.orderDate)}`,
        ...(po.expectedDate ? [`Expected: ${formatDate(po.expectedDate)}`] : []),
        `Status: ${po.status.replace(/_/g, " ")}`,
      ],
    },
  ]);

  let totalQty = 0;
  const rows: PDFTableRow[] = po.items.map((item, idx) => {
    totalQty += item.quantity;
    return {
      sl: idx + 1,
      item: item.description,
      hsn: item.hsnCode || "—",
      qty: item.quantity,
      rate: formatCurrency(item.unitPrice),
      amount: formatCurrency(item.lineTotal),
    };
  });

  builder.renderItemsTable(simpleInvoiceColumns(), rows, {
    sl: "",
    item: "TOTAL",
    hsn: "",
    qty: totalQty,
    rate: "",
    amount: formatCurrency(po.total),
  });

  const summaryLines: SummaryLine[] = [{ label: "Sub Total", value: formatCurrency(po.subtotal) }];
  if (num(po.discountAmount) > 0) {
    summaryLines.push({ label: "Discount", value: `-${formatCurrency(po.discountAmount)}` });
  }
  if (num(po.cgstAmount) > 0) summaryLines.push({ label: "CGST", value: formatCurrency(po.cgstAmount) });
  if (num(po.sgstAmount) > 0) summaryLines.push({ label: "SGST", value: formatCurrency(po.sgstAmount) });
  if (num(po.igstAmount) > 0) summaryLines.push({ label: "IGST", value: formatCurrency(po.igstAmount) });
  summaryLines.push({ label: "TOTAL", value: formatCurrency(po.total), highlight: true });

  builder.renderFinancialSummary({
    amountWordsLabel: "Amount In Words",
    amountWords: amountInWords(po.total),
    terms: po.notes || undefined,
    lines: summaryLines,
  });

  builder.renderSignatureBlock(
    [
      { title: "Prepared By", name: po.createdBy?.name },
      { title: `For ${company.name}` },
    ],
    "spread",
  );

  const buffer = await builder.build();
  return { buffer, fileName: `TECHNIC-PO-${po.poNumber.replace(/\//g, "-")}.pdf` };
}

// ---------------------------------------------------------------------------
// Purchase invoice (supplier bill)
// ---------------------------------------------------------------------------

export async function generatePurchaseInvoicePDF(invoiceId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      supplier: true,
      branch: true,
      lines: true,
      po: { select: { poNumber: true } },
      createdBy: { select: { name: true } },
    },
  });

  if (!invoice) throw new Error(`Purchase invoice #${invoiceId} not found.`);

  const company = await getCompanyProfile(invoice.firmId);
  const builder = new PDFDocumentBuilder(company);

  builder.renderCompanyHeader(branchProfile(invoice.branch));
  builder.renderDocumentTitle("Purchase Bill");

  builder.renderInfoColumns([
    {
      heading: "Supplier",
      lines: [
        invoice.supplier.name,
        ...(invoice.supplier.gstin ? [`GSTIN: ${invoice.supplier.gstin}`] : []),
        `Ph: ${invoice.supplier.phone || "—"}`,
      ],
    },
    {
      heading: "Bill Details",
      lines: [
        invoice.invoiceNumber,
        `Date: ${formatDate(invoice.invoiceDate)}`,
        ...(invoice.supplierRef ? [`Supplier Ref: ${invoice.supplierRef}`] : []),
        ...(invoice.po ? [`PO: ${invoice.po.poNumber}`] : []),
        ...(invoice.dueDate ? [`Due: ${formatDate(invoice.dueDate)}`] : []),
      ],
    },
  ]);

  let totalQty = 0;
  const rows: PDFTableRow[] = invoice.lines.map((line, idx) => {
    totalQty += line.quantity;
    return {
      sl: idx + 1,
      item: `${line.description}${serialSuffix(line.serialNumbers)}`,
      hsn: line.hsnCode || "—",
      qty: line.quantity,
      rate: formatCurrency(line.unitPrice),
      amount: formatCurrency(line.lineTotal),
    };
  });

  builder.renderItemsTable(simpleInvoiceColumns(), rows, {
    sl: "",
    item: "TOTAL",
    hsn: "",
    qty: totalQty,
    rate: "",
    amount: formatCurrency(invoice.total),
  });

  const summaryLines: SummaryLine[] = [{ label: "Sub Total", value: formatCurrency(invoice.subtotal) }];
  if (num(invoice.discountAmount) > 0) {
    summaryLines.push({ label: "Discount", value: `-${formatCurrency(invoice.discountAmount)}` });
  }
  if (num(invoice.cgstAmount) > 0) summaryLines.push({ label: "CGST", value: formatCurrency(invoice.cgstAmount) });
  if (num(invoice.sgstAmount) > 0) summaryLines.push({ label: "SGST", value: formatCurrency(invoice.sgstAmount) });
  if (num(invoice.igstAmount) > 0) summaryLines.push({ label: "IGST", value: formatCurrency(invoice.igstAmount) });
  summaryLines.push(
    { label: "TOTAL", value: formatCurrency(invoice.total), highlight: true },
    { label: "Paid", value: formatCurrency(invoice.amountPaid) },
    {
      label: "Balance",
      value: formatCurrency(Math.max(0, num(invoice.total) - num(invoice.amountPaid))),
      bold: true,
    },
  );

  builder.renderFinancialSummary({
    amountWordsLabel: "Amount In Words",
    amountWords: amountInWords(invoice.total),
    terms: invoice.notes || undefined,
    lines: summaryLines,
    bankDetails: company.bankDetails || undefined,
  });

  builder.renderSignatureBlock([{ title: `For ${company.name}`, name: invoice.createdBy?.name }]);

  const buffer = await builder.build();
  return { buffer, fileName: `TECHNIC-Purchase-Bill-${invoice.invoiceNumber.replace(/\//g, "-")}.pdf` };
}

// ---------------------------------------------------------------------------
// Payment receipt
// ---------------------------------------------------------------------------

export async function generatePaymentReceiptPDF(paymentId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      customer: true,
      invoice: true,
      branch: true,
      receivedBy: { select: { name: true } },
    },
  });

  if (!payment) throw new Error(`Payment #${paymentId} not found.`);

  const company = await getCompanyProfile(payment.firmId);
  const builder = new PDFDocumentBuilder(company);

  builder.renderCompanyHeader(branchProfile(payment.branch));
  builder.renderDocumentTitle("Payment Receipt");

  builder.renderInfoColumns([
    {
      heading: "Received From",
      lines: [payment.customer?.name || "Walk-in Customer", `Ph: ${payment.customer?.phone || "—"}`],
    },
    {
      heading: "Receipt Details",
      lines: [
        payment.paymentNumber,
        `Date: ${formatDate(payment.paidAt)}`,
        ...(payment.invoice ? [`Invoice: ${payment.invoice.invoiceNumber}`] : ["Advance / on account"]),
      ],
    },
  ]);

  const summaryLines: SummaryLine[] = [
    { label: "Amount Received", value: formatCurrency(payment.amount), highlight: true },
    { label: "Payment Method", value: PAYMENT_METHOD_LABEL[payment.method] || payment.method },
  ];
  if (payment.reference) {
    summaryLines.push({ label: "Reference", value: payment.reference });
  }
  if (payment.invoice) {
    summaryLines.push(
      { label: "Invoice Total", value: formatCurrency(payment.invoice.totalAmount) },
      { label: "Balance After This Receipt", value: formatCurrency(payment.invoice.amountDue), bold: true },
    );
  }

  builder.renderFinancialSummary({
    amountWordsLabel: "Amount In Words",
    amountWords: amountInWords(payment.amount),
    terms: "This is a computer-generated receipt issued by Technic Technologies.",
    lines: summaryLines,
  });

  builder.renderSignatureBlock([{ title: `For ${company.name}`, name: payment.receivedBy?.name }]);

  const buffer = await builder.build();
  return { buffer, fileName: `TECHNIC-Receipt-${payment.paymentNumber.replace(/\//g, "-")}.pdf` };
}

// ---------------------------------------------------------------------------
// Expense voucher
// ---------------------------------------------------------------------------

export async function generateExpenseReceiptPDF(expenseId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { branch: true, createdBy: { select: { name: true } }, approvedBy: { select: { name: true } } },
  });

  if (!expense) throw new Error(`Expense #${expenseId} not found.`);

  const company = await getCompanyProfile(expense.firmId);
  const builder = new PDFDocumentBuilder(company);

  builder.renderCompanyHeader(branchProfile(expense.branch));
  builder.renderDocumentTitle("Expense Voucher");

  builder.renderInfoColumns([
    {
      heading: "Paid To",
      lines: [expense.paidTo || "Operational Expense", `Category: ${expense.category.replace(/_/g, " ")}`],
    },
    {
      heading: "Voucher Details",
      lines: [
        expense.expenseNumber,
        `Date: ${formatDate(expense.expenseDate)}`,
        `Method: ${PAYMENT_METHOD_LABEL[expense.paymentMethod] || expense.paymentMethod}`,
        `Status: ${expense.status}`,
      ],
    },
  ]);

  const rows: PDFTableRow[] = [
    { sl: 1, item: expense.description, hsn: "—", qty: 1, rate: formatCurrency(expense.amount), amount: formatCurrency(expense.amount) },
  ];

  builder.renderItemsTable(simpleInvoiceColumns(), rows, {
    sl: "",
    item: "TOTAL",
    hsn: "",
    qty: 1,
    rate: "",
    amount: formatCurrency(expense.amount),
  });

  builder.renderFinancialSummary({
    amountWordsLabel: "Amount In Words",
    amountWords: amountInWords(expense.amount),
    lines: [{ label: "Amount", value: formatCurrency(expense.amount), highlight: true }],
  });

  builder.renderSignatureBlock(
    [
      { title: "Prepared By", name: expense.createdBy?.name || company.name },
      { title: "Approved By", name: expense.approvedBy?.name },
      { title: `For ${company.name}` },
    ],
    "spread",
  );

  const buffer = await builder.build();
  return { buffer, fileName: `TECHNIC-Expense-${expense.expenseNumber.replace(/\//g, "-")}.pdf` };
}
