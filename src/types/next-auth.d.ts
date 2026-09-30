import type { DefaultSession } from "next-auth";
import type { TaxMode, UserRole } from "@/generated/prisma/enums";
import type { PermissionCode } from "@/lib/rbac";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      branchId: string | null;
      branchName: string | null;
      branchCode: string | null;
      employeeCode: string | null;
      permissions: PermissionCode[];
      firmId: string | null;
      firmName: string | null;
      activeFirmId: string | null;
      activeFirmName: string | null;
      accessMode: TaxMode;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    branchId: string | null;
    branchName?: string | null;
    branchCode?: string | null;
    employeeCode?: string | null;
    permissions: PermissionCode[];
    firmId: string | null;
    firmName?: string | null;
    activeFirmId: string | null;
    activeFirmName?: string | null;
    accessMode?: TaxMode;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    branchId: string | null;
    branchName: string | null;
    branchCode: string | null;
    employeeCode: string | null;
    permissions: PermissionCode[];
    firmId: string | null;
    firmName: string | null;
    activeFirmId: string | null;
    activeFirmName: string | null;
    accessMode: TaxMode;
  }
}
