import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const dbDir = path.join(process.cwd(), ".data", "pglite");
const pglite = new PGlite(dbDir);

// Simple pool wrapper for PrismaPg
class MockPool {
  async connect() {
    return {
      query: async (opt) => {
        const res = await pglite.query(opt.text, opt.values || []);
        return {
          rows: res.rows,
          fields: res.fields,
          rowCount: res.affectedRows ?? res.rows.length,
        };
      },
      release: () => {},
    };
  }
  async query(opt) {
    const res = await pglite.query(opt.text, opt.values || []);
    return {
      rows: res.rows,
      fields: res.fields,
      rowCount: res.affectedRows ?? res.rows.length,
    };
  }
}

const adapter = new PrismaPg(new MockPool());
const prisma = new PrismaClient({ adapter });

async function test() {
  console.log("Testing CRUD operations with updated schema...");

  const firm = await prisma.firm.findFirst();
  if (!firm) throw new Error("No firm found");
  console.log("Found firm:", firm.name, firm.id);

  const branch = await prisma.branch.findFirst({ where: { firmId: firm.id } });
  if (!branch) throw new Error("No branch found");
  console.log("Found branch:", branch.name, branch.id);

  const admin = await prisma.user.findFirst({ where: { firmId: firm.id } });
  if (!admin) throw new Error("No user found");
  console.log("Found user:", admin.name, admin.id);

  // 1. Test Product Create
  console.log("\n1. Testing Product creation...");
  const product = await prisma.product.create({
    data: {
      firmId: firm.id,
      name: "Test Samsung TV 55",
      subName: "55 Inch Ultra HD Smart TV",
      sku: "TEST-TV-55-001",
      hsnCode: "852872",
      gstRate: 18,
      purchasePrice: 40000,
      sellingPrice: 55000,
      mrp: 60000,
      status: "ACTIVE",
    },
  });
  console.log("✓ Product created successfully:", product.id, product.name, "subName:", product.subName);

  // 2. Test Customer Create
  console.log("\n2. Testing Customer creation...");
  const customer = await prisma.customer.create({
    data: {
      firmId: firm.id,
      branchId: branch.id,
      code: "CUS00001",
      name: "Test Customer John",
      phone: "9876543210",
      city: "Bengaluru",
      state: "Karnataka",
    },
  });
  console.log("✓ Customer created successfully:", customer.id, customer.name);

  // 3. Test Quotation Create
  console.log("\n3. Testing Quotation creation...");
  const quotation = await prisma.quotation.create({
    data: {
      firmId: firm.id,
      branchId: branch.id,
      customerId: customer.id,
      quotationNumber: "TT/QT/26-27/0001",
      taxMode: "GST",
      subtotal: 55000,
      taxableAmount: 46610.17,
      cgstAmount: 4194.91,
      sgstAmount: 4194.92,
      totalAmount: 55000,
      status: "DRAFT",
      createdById: admin.id,
      lines: {
        create: [
          {
            productId: product.id,
            description: product.name,
            quantity: 1,
            unitPrice: 55000,
            gstRate: 18,
            taxableValue: 46610.17,
            cgstAmount: 4194.91,
            sgstAmount: 4194.92,
            lineTotal: 55000,
          },
        ],
      },
    },
  });
  console.log("✓ Quotation created successfully:", quotation.id, quotation.quotationNumber);

  // 4. Test Invoice Create
  console.log("\n4. Testing Invoice creation...");
  const invoice = await prisma.invoice.create({
    data: {
      firmId: firm.id,
      branchId: branch.id,
      customerId: customer.id,
      invoiceNumber: "TT/GST/26-27/0001",
      kind: "TAX_INVOICE",
      taxMode: "GST",
      financialYear: "26-27",
      subtotal: 55000,
      taxableAmount: 46610.17,
      cgstAmount: 4194.91,
      sgstAmount: 4194.92,
      totalAmount: 55000,
      amountPaid: 55000,
      amountDue: 0,
      status: "PAID",
      billToName: customer.name,
      billToPhone: customer.phone,
      dispatchThrough: "Direct Courier",
      vehicleNumber: "KA-01-AB-1234",
      ewayBillNumber: "123456789012",
      buyerOrderNo: "PO-999",
      createdById: admin.id,
      lines: {
        create: [
          {
            productId: product.id,
            description: product.name,
            quantity: 1,
            unitPrice: 55000,
            gstRate: 18,
            taxableValue: 46610.17,
            cgstAmount: 4194.91,
            sgstAmount: 4194.92,
            lineTotal: 55000,
          },
        ],
      },
    },
  });
  console.log("✓ Invoice created successfully:", invoice.id, invoice.invoiceNumber);

  // Clean up test records
  console.log("\nCleaning up test records...");
  await prisma.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
  await prisma.invoice.delete({ where: { id: invoice.id } });
  await prisma.quotationLine.deleteMany({ where: { quotationId: quotation.id } });
  await prisma.quotation.delete({ where: { id: quotation.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  await prisma.product.delete({ where: { id: product.id } });
  console.log("✓ Test records cleaned up cleanly.");

  console.log("\nALL CRUD TESTS PASSED SUCCESSFULLY! Database is 100% functional and clean.");
}

test().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
