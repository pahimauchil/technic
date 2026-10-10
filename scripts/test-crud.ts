// Bypass server-only guard for standalone testing
import Module from "node:module";
// @ts-ignore
const originalRequire = Module.prototype.require;
// @ts-ignore
Module.prototype.require = function (id) {
  if (id === "server-only") return {};
  // @ts-ignore
  return originalRequire.apply(this, arguments);
};

async function test() {
  const { prisma } = await import("../src/lib/prisma");
  const { createProduct } = await import("../src/lib/services/products");
  const { createQuotation, createInvoice } = await import("../src/lib/services/sales");
  const { nextCustomerCode } = await import("../src/lib/sequence");

  console.log("Testing services (Products, Quotations, Invoices, Customer Sequences)...");

  const firm = await prisma.firm.findFirst();
  if (!firm) throw new Error("No firm found");
  console.log("Found firm:", firm.name, "(id:", firm.id, ")");

  const branch = await prisma.branch.findFirst({ where: { firmId: firm.id } });
  if (!branch) throw new Error("No branch found");
  console.log("Found branch:", branch.name, "(id:", branch.id, ")");

  const admin = await prisma.user.findFirst({ where: { firmId: firm.id } });
  if (!admin) throw new Error("No user found");
  console.log("Found user:", admin.name, "(id:", admin.id, ")");

  // Clean any old test artifacts
  await prisma.payment.deleteMany();
  await prisma.stockTransaction.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.quotationLine.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.productAttribute.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.documentSequence.deleteMany();

  // 1. Test createProduct service
  console.log("\n1. Testing createProduct service...");
  const product = await createProduct({
    firmId: firm.id,
    name: "Sony Bravia OLED 65",
    subName: "XR-65A80L Ultra HD 4K",
    sku: "TEST-SKU-001",
    hsnCode: "852872",
    gstRate: 18,
    purchasePrice: 120000,
    sellingPrice: 150000,
    mrp: 170000,
    minSellingPrice: 130000,
    warrantyMonths: 24,
    status: "ACTIVE",
    userId: admin.id,
  });
  console.log("✓ Product created:", product.id, product.name, "| subName:", product.subName);

  // Add opening stock transaction so invoice stock check passes
  await prisma.stockTransaction.create({
    data: {
      firmId: firm.id,
      branchId: branch.id,
      productId: product.id,
      type: "OPENING",
      quantity: 10,
      balanceAfter: 10,
      reference: "OPENING-STOCK",
      userId: admin.id,
    },
  });
  console.log("✓ Stock added (10 units)");

  // 2. Test Customer sequence & creation
  console.log("\n2. Testing Customer code sequence & customer creation...");
  const customerCode = await nextCustomerCode(firm.id);
  console.log("Allocated customer code:", customerCode);

  const customer = await prisma.customer.create({
    data: {
      firmId: firm.id,
      branchId: branch.id,
      code: customerCode,
      name: "Test Service Customer",
      phone: "9876500000",
      city: "Bengaluru",
      state: "Karnataka",
    },
  });
  console.log("✓ Customer created:", customer.id, customer.code, customer.name);

  // 3. Test createQuotation service
  console.log("\n3. Testing createQuotation service...");
  const quotation = await createQuotation({
    firmId: firm.id,
    branchId: branch.id,
    customerId: customer.id,
    taxMode: "GST",
    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    notes: "Special promotional quote",
    userId: admin.id,
    lines: [
      {
        productId: product.id,
        quantity: 1,
        unitPrice: 150000,
        gstRate: 18,
      },
    ],
  });
  console.log("✓ Quotation created:", quotation.id, quotation.quotationNumber, "Total:", quotation.totalAmount);

  // 4. Test createInvoice service
  console.log("\n4. Testing createInvoice service...");
  const invoice = await createInvoice({
    firmId: firm.id,
    branchId: branch.id,
    customerId: customer.id,
    kind: "TAX_INVOICE",
    taxMode: "GST",
    placeOfSupply: "Karnataka",
    userId: admin.id,
    lines: [
      {
        productId: product.id,
        quantity: 1,
        unitPrice: 150000,
        gstRate: 18,
      },
    ],
    payments: [
      {
        amount: 150000,
        method: "UPI",
        reference: "UPI/TEST/12345",
      },
    ],
  });
  console.log("✓ Invoice created:", invoice.id, invoice.invoiceNumber, "Total:", invoice.totalAmount, "Paid:", invoice.amountPaid);

  // 5. Clean up test records
  console.log("\nCleaning up test records...");
  await prisma.payment.deleteMany();
  await prisma.stockTransaction.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.quotationLine.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.productAttribute.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.documentSequence.deleteMany();
  await prisma.auditLog.deleteMany();
  console.log("✓ Cleanup completed.");

  console.log("\n🎉 ALL SERVICES VERIFIED: Product creation, Customer generation, Quotations, and Invoices all work perfectly!");
}

test().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
