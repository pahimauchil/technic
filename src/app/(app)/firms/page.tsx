import Link from "next/link";
import { Settings } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EnterFirmButton } from "./enter-button";
import { CreateFirmButton } from "./create-button";
import { EditFirmButton } from "./edit-button";
import { RestoreFirmButton } from "./restore-button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { isPlatformRole } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";
import { purgeExpiredFirms } from "@/lib/firm-trash.server";
import {
  TRASH_RETENTION_DAYS,
  trashDaysLeft,
  trashRetentionEnd,
  trashRetentionElapsed,
} from "@/lib/firm-trash";

export const metadata = { title: "Firms — Technic Technologies" };

const firmCounts = { _count: { select: { users: true, branches: true, products: true } } } as const;

export default async function FirmsPage() {
  const user = await requirePermission("firms.view");
  const platformAdmin = isPlatformRole(user.role);
  const isAdmin = user.role === "ADMIN";
  const canManageFirms = user.permissions.includes("firms.manage" as const);
  const canSwitchFirms = platformAdmin || isAdmin || canManageFirms;

  // Firms whose 100-day trash window has closed are purged before we list.
  await purgeExpiredFirms();

  const [firms, trashedFirms] = await Promise.all([
    canSwitchFirms
      ? prisma.firm.findMany({
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          include: firmCounts,
        })
      : prisma.firm.findMany({
          where: { id: user.firmId ?? "", deletedAt: null },
          orderBy: { name: "asc" },
          include: firmCounts,
        }),
    prisma.firm.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        deletedAt: true,
        ...firmCounts,
      },
    }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Firms"
        description={
          canSwitchFirms
            ? "Select a firm to operate in — its data, users and access modes"
            : "Your firm's registration profile"
        }
        actions={canManageFirms ? <CreateFirmButton /> : null}
      />

      <div className="grid gap-3 md:grid-cols-2">
        {firms.map((firm) => (
          <Card key={firm.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="truncate">{firm.displayName || firm.name}</span>
                <Badge tone={firm.status === "ACTIVE" ? "success" : "danger"}>{firm.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{firm.legalName ?? firm.name}</p>
              {firm.gstin ? <p className="font-mono text-xs">GSTIN {firm.gstin}</p> : <p className="text-xs text-warning">No GSTIN</p>}
              <p className="text-xs text-muted-foreground">
                {[firm.city, firm.state].filter(Boolean).join(", ") || "Location not set"}
                {" · FY "}{firm.financialYear}
              </p>
              <p className="text-xs text-muted-foreground">
                {firm._count.users} users · {firm._count.branches} branches · {firm._count.products} products
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">Created {formatDate(firm.createdAt)}</span>
                <div className="flex items-center gap-2">
                  {canSwitchFirms ? (
                    user.activeFirmId === firm.id ? (
                      <Badge tone="success">Operating here</Badge>
                    ) : (
                      <EnterFirmButton firmId={firm.id} firmName={firm.displayName || firm.name} disabled={firm.status !== "ACTIVE"} />
                    )
                  ) : null}
                  <Button asChild size="sm" variant="outline" title="Firm settings">
                    <Link href={`/firms/${firm.id}/settings`} aria-label="Firm settings">
                      <Settings className="h-4 w-4" />
                    </Link>
                  </Button>
                  {canManageFirms && (
                    <EditFirmButton firmId={firm.id} firmName={firm.displayName || firm.name} />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {canManageFirms && trashedFirms.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Trash</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Trashed firms are hidden from everyone and cannot be signed in to. Their data is kept for{" "}
              {TRASH_RETENTION_DAYS} days, then deleted permanently.
            </p>
            <ul className="divide-y">
              {trashedFirms.map((firm) => {
                if (!firm.deletedAt) return null;
                const expired = trashRetentionElapsed(firm.deletedAt);
                const daysLeft = trashDaysLeft(firm.deletedAt);
                const purgeOn = formatDate(trashRetentionEnd(firm.deletedAt));
                return (
                  <li key={firm.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {firm.displayName || firm.name}{" "}
                        <span className="font-mono text-xs text-muted-foreground">{firm.code}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Trashed {formatDate(firm.deletedAt)} ·{" "}
                        {expired ? (
                          <span className="text-warning">retention expired, purging</span>
                        ) : (
                          <>purges {purgeOn} · {daysLeft} day{daysLeft === 1 ? "" : "s"} left</>
                        )}
                      </p>
                    </div>
                    {expired ? null : (
                      <RestoreFirmButton firmId={firm.id} firmName={firm.displayName || firm.name} />
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
