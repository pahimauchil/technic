import fs from "fs";
import path from "path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

class PGliteClient {
  constructor(private pglite: PGlite) {}

  async query(options: { text: string; values?: any[]; rowMode?: string }) {
    const { text, values, rowMode } = options;
    const res = await this.pglite.query(text, values || []);
    if (rowMode === "array") {
      const rows = res.rows.map((row: any) =>
        res.fields.map((f: any) => row[f.name])
      );
      return {
        rows,
        fields: res.fields,
        rowCount: res.affectedRows ?? res.rows.length,
      };
    }
    return {
      rows: res.rows,
      fields: res.fields,
      rowCount: res.affectedRows ?? res.rows.length,
    };
  }

  on() {}
  removeListener() {}
  release() {}
}

class PGlitePool extends pg.Pool {
  constructor(private pglite: PGlite, private initPromise?: Promise<void>) {
    super();
  }

  // @ts-ignore
  async connect() {
    if (this.initPromise) await this.initPromise;
    return new PGliteClient(this.pglite) as any;
  }

  // @ts-ignore
  async query(options: { text: string; values?: any[]; rowMode?: string }) {
    if (this.initPromise) await this.initPromise;
    const client = new PGliteClient(this.pglite);
    return client.query(options);
  }

  on() { return this as any; }
  removeListener() { return this as any; }
}

const globalForPGlite = globalThis as unknown as {
  pgliteInstance?: PGlite;
  pgliteInitPromise?: Promise<void>;
};

export function getPGlitePool(): PGlitePool {
  const dbDir = path.join(process.cwd(), ".data", "pglite");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (!globalForPGlite.pgliteInstance) {
    globalForPGlite.pgliteInstance = new PGlite(dbDir);
  }

  const pglite = globalForPGlite.pgliteInstance;

  if (!globalForPGlite.pgliteInitPromise) {
    globalForPGlite.pgliteInitPromise = (async () => {
      try {
        const tableCheck = await pglite.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='customers';"
        );
        if (tableCheck.rows.length === 0) {
          console.log("[DB Setup] Auto-initializing database schema from full_schema.sql...");
          const fullSchemaPath = path.join(process.cwd(), "prisma", "full_schema.sql");
          if (fs.existsSync(fullSchemaPath)) {
            const sql = fs.readFileSync(fullSchemaPath, "utf8");
            await pglite.exec(sql);
          } else {
            const initSqlPath = path.join(process.cwd(), "prisma", "migrations", "0_init", "migration.sql");
            if (fs.existsSync(initSqlPath)) {
              const initSql = fs.readFileSync(initSqlPath, "utf8");
              await pglite.exec(initSql);
            }
          }
          console.log("[DB Setup] Schema initialized successfully!");
        }
      } catch (err) {
        console.error("[DB Setup] Migration error:", err);
      }
    })();
  }

  return new PGlitePool(pglite, globalForPGlite.pgliteInitPromise);
}
