import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { resolvePermissions } from "@/lib/permissions.server";
import { isPlatformRole } from "@/lib/rbac";
import type { PermissionCode } from "@/lib/rbac";
import type { TaxMode, UserRole } from "@/generated/prisma/enums";

const credentialsSchema = z.object({
  accessCode: z.string().trim().min(1),
});

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        accessCode: { label: "Access code", type: "text" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { accessCode: parsed.data.accessCode },
          include: {
            branch: { select: { id: true, name: true, code: true } },
            firm: { select: { id: true, name: true, status: true } },
          },
        });

        if (!user || user.status !== "ACTIVE") return null;

        // A firm's users cannot sign in while their firm is deactivated.
        if (user.firm && user.firm.status !== "ACTIVE") return null;

        const permissions = await resolvePermissions(user.id, user.role);

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          branchId: user.branchId,
          branchName: user.branch?.name ?? null,
          branchCode: user.branch?.code ?? null,
          employeeCode: user.employeeCode,
          permissions,
          firmId: user.firmId,
          firmName: user.firm?.name ?? null,
          // A regular firm user's active firm is always their own, fixed
          // firm — never switchable. A PLATFORM_ADMIN starts with none
          // active until they explicitly enter one from the Firms module.
          activeFirmId: isPlatformRole(user.role) ? null : user.firmId,
          activeFirmName: isPlatformRole(user.role) ? null : (user.firm?.name ?? null),
          // Sessions start in the least-privileged tax mode; entering a GST
          // access code (or choosing the mode in the Firms switcher) raises it.
          accessMode: "NON_GST" as TaxMode,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger, session: updateData }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.branchId = user.branchId;
        token.branchName = user.branchName;
        token.branchCode = user.branchCode;
        token.employeeCode = user.employeeCode;
        token.permissions = user.permissions;
        token.firmId = user.firmId;
        token.firmName = user.firmName;
        token.activeFirmId = user.activeFirmId;
        token.activeFirmName = user.activeFirmName;
        token.accessMode = (user as { accessMode?: TaxMode }).accessMode ?? "NON_GST";
      }

      // Re-read role/branch/permissions when the client explicitly asks for a
      // refresh (e.g. after an admin changes this user's access), and handle
      // the Firms-module "enter firm" switch (PLATFORM_ADMIN only) plus the
      // access-code gate's mode escalation.
      if (trigger === "update" && token.id) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          include: {
            branch: { select: { id: true, name: true, code: true } },
            firm: { select: { id: true, name: true } },
          },
        });
        if (fresh && fresh.status === "ACTIVE") {
          token.role = fresh.role;
          token.branchId = fresh.branchId;
          token.branchName = fresh.branch?.name ?? null;
          token.branchCode = fresh.branch?.code ?? null;
          token.permissions = await resolvePermissions(fresh.id, fresh.role);
          token.firmId = fresh.firmId;
          token.firmName = fresh.firm?.name ?? null;
        }

        const payload = updateData as
          | { activeFirmId?: string | null; accessMode?: TaxMode }
          | undefined;

        const requestedFirmId = payload?.activeFirmId;
        if (requestedFirmId !== undefined && isPlatformRole(token.role as UserRole)) {
          if (requestedFirmId === null) {
            token.activeFirmId = null;
            token.activeFirmName = null;
            token.accessMode = "NON_GST";
          } else {
            const targetFirm = await prisma.firm.findUnique({
              where: { id: requestedFirmId },
              select: { id: true, name: true, status: true },
            });
            if (targetFirm && targetFirm.status === "ACTIVE") {
              token.activeFirmId = targetFirm.id;
              token.activeFirmName = targetFirm.name;
            }
          }
        }

        // Mode escalation. GST can only be granted through the access-code
        // gate action, which validated the code against the firm before
        // asking for this update — the gate is the only place that may send
        // accessMode: "GST".
        const requestedMode = payload?.accessMode;
        if (requestedMode !== undefined) {
          token.accessMode = requestedMode === "GST" ? "GST" : "NON_GST";
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
        session.user.branchId = (token.branchId as string | null) ?? null;
        session.user.branchName = (token.branchName as string | null) ?? null;
        session.user.branchCode = (token.branchCode as string | null) ?? null;
        session.user.employeeCode = (token.employeeCode as string | null) ?? null;
        session.user.permissions = (token.permissions as PermissionCode[]) ?? [];
        session.user.firmId = (token.firmId as string | null) ?? null;
        session.user.firmName = (token.firmName as string | null) ?? null;
        session.user.activeFirmId = (token.activeFirmId as string | null) ?? null;
        session.user.activeFirmName = (token.activeFirmName as string | null) ?? null;
        session.user.accessMode = ((token.accessMode as TaxMode) === "GST" ? "GST" : "NON_GST") as TaxMode;
      }
      return session;
    },
  },
});
