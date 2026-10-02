import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getPGlitePool } from "@/lib/db-setup";

const createPrismaClient = (): PrismaClient => {
  const connectionString = process.env.DATABASE_URL;
  const adapter = connectionString
    ? new PrismaPg({ connectionString })
    : new PrismaPg(getPGlitePool() as any);

  return new PrismaClient({
    adapter,
    transactionOptions: { maxWait: 5_000, timeout: 30_000 },
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }
  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const instance = getPrismaClient();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export type { Prisma } from "@/generated/prisma/client";
