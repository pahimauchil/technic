import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

async function run() {
  const dbDir = path.join(process.cwd(), ".data", "pglite");
  console.log("Connecting to PGlite database at:", dbDir);
  const pglite = new PGlite(dbDir);

  // 1. Check migrations in prisma/migrations
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const migrationDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  console.log("Found migration directories:", migrationDirs);

  // Apply migrations in order
  for (const dir of migrationDirs) {
    const migrationFile = path.join(migrationsDir, dir, "migration.sql");
    if (fs.existsSync(migrationFile)) {
      console.log(`Applying migration: ${dir}...`);
      const sql = fs.readFileSync(migrationFile, "utf-8");
      try {
        await pglite.exec(sql);
        console.log(`✓ Migration ${dir} applied successfully.`);
      } catch (err) {
        console.warn(`! Migration ${dir} warning:`, err.message);
      }
    }
  }

  // Double check critical columns & tables
  const columnChecks = [
    `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "subName" TEXT;`,
    `ALTER TABLE "firms" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);`,
    `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "dispatchThrough" TEXT;`,
    `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "vehicleNumber" TEXT;`,
    `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "ewayBillNumber" TEXT;`,
    `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyerOrderNo" TEXT;`,
    `ALTER TABLE "goods_receipts" ALTER COLUMN "poId" DROP NOT NULL;`,
  ];

  for (const sql of columnChecks) {
    try {
      await pglite.exec(sql);
    } catch (err) {
      console.warn("Column check note:", err.message);
    }
  }

  console.log("\nCleaning all dummy data except users...");

  // Transactional tables & catalogue data to clear
  const cleanupQueries = [
    `DELETE FROM "serial_history";`,
    `DELETE FROM "serial_units";`,
    `DELETE FROM "warranties";`,
    `DELETE FROM "stock_transactions";`,
    `DELETE FROM "stock_adjustments";`,
    `DELETE FROM "stock_transfer_lines";`,
    `DELETE FROM "stock_transfers";`,
    `DELETE FROM "payments";`,
    `DELETE FROM "sales_return_lines";`,
    `DELETE FROM "sales_returns";`,
    `DELETE FROM "invoice_lines";`,
    `DELETE FROM "invoices";`,
    `DELETE FROM "sales_order_lines";`,
    `DELETE FROM "sales_orders";`,
    `DELETE FROM "quotation_lines";`,
    `DELETE FROM "quotations";`,
    `DELETE FROM "goods_receipt_lines";`,
    `DELETE FROM "goods_receipts";`,
    `DELETE FROM "supplier_payments";`,
    `DELETE FROM "purchase_invoice_lines";`,
    `DELETE FROM "purchase_invoices";`,
    `DELETE FROM "purchase_return_lines";`,
    `DELETE FROM "purchase_returns";`,
    `DELETE FROM "purchase_order_lines";`,
    `DELETE FROM "purchase_orders";`,
    `DELETE FROM "expenses";`,
    `DELETE FROM "journal_entries";`,
    `DELETE FROM "whatsapp_logs";`,
    `DELETE FROM "product_attributes";`,
    `DELETE FROM "product_variants";`,
    `DELETE FROM "products";`,
    `DELETE FROM "brands";`,
    `DELETE FROM "categories";`,
    `DELETE FROM "customers";`,
    `DELETE FROM "suppliers";`,
    `DELETE FROM "document_sequences";`,
    `DELETE FROM "sequences";`,
    `DELETE FROM "audit_logs";`,
  ];

  for (const q of cleanupQueries) {
    try {
      await pglite.exec(q);
      const tableName = q.match(/FROM\s+"([^"]+)"/i)?.[1] || q;
      console.log(`✓ Cleared ${tableName}`);
    } catch (err) {
      console.warn(`! Warning on ${q}:`, err.message);
    }
  }

  // Verify users and firms remain intact
  const usersRes = await pglite.query(`SELECT id, "name", email, role, "accessCode" FROM "users";`);
  console.log(`\nRemaining Users (${usersRes.rows.length}):`);
  for (const u of usersRes.rows) {
    console.log(`  - ${u.name} (${u.role}) | Login: ${u.accessCode} | Email: ${u.email}`);
  }

  const firmsRes = await pglite.query(`SELECT id, "name", code FROM "firms";`);
  console.log(`\nRemaining Firms (${firmsRes.rows.length}):`);
  for (const f of firmsRes.rows) {
    console.log(`  - ${f.name} (Code: ${f.code})`);
  }

  const branchesRes = await pglite.query(`SELECT id, "name", code FROM "branches";`);
  console.log(`\nRemaining Branches (${branchesRes.rows.length}):`);
  for (const b of branchesRes.rows) {
    console.log(`  - ${b.name} (Code: ${b.code})`);
  }

  console.log("\nDatabase migration and dummy data cleanup complete!");
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
