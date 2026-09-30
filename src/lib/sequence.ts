import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { TaxMode } from "@/generated/prisma/enums";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Atomically increments a named counter and returns the new value.
 * Uses a single INSERT .. ON CONFLICT DO UPDATE so that concurrent callers
 * can never receive the same number.
 */
export async function nextSequence(key: string, db: Db = prisma): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "sequences" ("key", "value", "updatedAt")
    VALUES (${key}, 1, NOW())
    ON CONFLICT ("key")
    DO UPDATE SET "value" = "sequences"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `;
  return rows[0]?.value ?? 1;
}

/**
 * Atomically increments a per-firm document counter (firmed by document type,
 * access mode and financial year) and returns the new value. GST and NON-GST
 * invoices therefore count on entirely separate sequences and can never collide.
 */
export async function nextDocumentSequence(
  firmId: string,
  documentType: string,
  accessMode: TaxMode,
  financialYear: string,
  db: Db = prisma,
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "document_sequences"
      ("id", "firmId", "documentType", "accessMode", "financialYear", "value", "updatedAt")
    VALUES (gen_random_uuid()::text, ${firmId}, ${documentType}, ${accessMode}::"TaxMode", ${financialYear}, 1, NOW())
    ON CONFLICT ("firmId", "documentType", "accessMode", "financialYear")
    DO UPDATE SET "value" = "document_sequences"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `;
  return rows[0]?.value ?? 1;
}

/** 2026-27 → "26-27". April–March Indian financial year. */
export function financialYearFor(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  const startYear = month >= 4 ? year : year - 1;
  const endYearShort = (startYear + 1) % 100;
  return `${String(startYear % 100).padStart(2, "0")}-${String(endYearShort).padStart(2, "0")}`;
}

export const DOCUMENT_TYPES = {
  INVOICE: "invoice",
  QUOTATION: "quotation",
  SALES_ORDER: "sales_order",
  PURCHASE_ORDER: "purchase_order",
  PURCHASE_INVOICE: "purchase_invoice",
  SALES_RETURN: "sales_return",
  PURCHASE_RETURN: "purchase_return",
  PAYMENT: "payment",
  CREDIT_NOTE: "credit_note",
  DEBIT_NOTE: "debit_note",
  STOCK_TRANSFER: "stock_transfer",
  EXPENSE: "expense",
  CUSTOMER: "customer",
  SUPPLIER: "supplier",
} as const;

/** Turn a prefix template like "TT/GST/{FY}/" + 4-digit padding into a number. */
function formatNumber(prefix: string, value: number, width = 4): string {
  return `${prefix}${String(value).padStart(width, "0")}`;
}

/**
 * Allocates the next document number for a firm. The default prefixes follow
 * the handover examples — GST: TT/GST/26-27/0001, non-GST: TT/NG/26-27/0001 —
 * and every prefix is overridable per firm in settings.
 */
export async function nextDocumentNumber(
  firmId: string,
  documentType: string,
  accessMode: TaxMode,
  db: Db = prisma,
  date: Date = new Date(),
): Promise<string> {
  const fy = financialYearFor(date);

  const settings = await prisma.setting.findMany({
    where: { firmId, key: { in: [`sequence_${documentType}_${accessMode.toLowerCase()}`, `sequence_${documentType}`] } },
  });
  const map = new Map(settings.map((s) => [s.key, s.value]));
  const custom = map.get(`sequence_${documentType}_${accessMode.toLowerCase()}`) ?? map.get(`sequence_${documentType}`);

  let prefix: string;
  if (custom) {
    prefix = custom
      .replace("{FY}", fy)
      .replace("{MODE}", accessMode === "GST" ? "GST" : "NG")
      .replace("{TYPE}", documentType.toUpperCase());
  } else if (documentType === DOCUMENT_TYPES.INVOICE) {
    prefix = accessMode === "GST" ? `TT/GST/${fy}/` : `TT/NG/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.QUOTATION) {
    prefix = `TT/QT/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.SALES_ORDER) {
    prefix = `TT/SO/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.PURCHASE_ORDER) {
    prefix = `TT/PO/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.PURCHASE_INVOICE) {
    prefix = `TT/PI/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.SALES_RETURN) {
    prefix = `TT/SR/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.PURCHASE_RETURN) {
    prefix = `TT/PR/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.PAYMENT) {
    prefix = `TT/PAY/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.CREDIT_NOTE) {
    prefix = `TT/CN/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.DEBIT_NOTE) {
    prefix = `TT/DN/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.STOCK_TRANSFER) {
    prefix = `TT/ST/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.EXPENSE) {
    prefix = `TT/EXP/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.CUSTOMER) {
    prefix = "CUS";
  } else if (documentType === DOCUMENT_TYPES.SUPPLIER) {
    prefix = "SUP";
  } else {
    prefix = `TT/${documentType.toUpperCase()}/${fy}/`;
  }

  const plain = /^[A-Za-z0-9/-]+$/.test(prefix);
  if (!plain) {
    // The padded number is still unique per firm+type+mode+FY even with a
    // slashed prefix; uniqueness of the final string is enforced by callers.
    return formatNumber(prefix, await nextDocumentSequence(firmId, documentType, accessMode, fy, db));
  }
  return formatNumber(prefix, await nextDocumentSequence(firmId, documentType, accessMode, fy, db));
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}

/** Short customer/supplier codes: CUS00001. */
export const nextCustomerCode = async (firmId: string, db: Db = prisma) =>
  formatNumber("CUS", await nextDocumentSequence(firmId, DOCUMENT_TYPES.CUSTOMER, "NON_GST", "ALL", db), 5);
export const nextSupplierCode = async (firmId: string, db: Db = prisma) =>
  formatNumber("SUP", await nextDocumentSequence(firmId, DOCUMENT_TYPES.SUPPLIER, "NON_GST", "ALL", db), 5);
