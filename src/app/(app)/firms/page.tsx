import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EnterFirmButton } from "./enter-button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { isPlatformRole } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Firms — Technic Technologies" };

export default async function FirmsPage() {
  const user = await requirePermission("firms.view");
  const platformAdmin = isPlatformRole(user.role);

  const firms = platformAdmin
    ? await prisma.firm.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { users: true, branches: true, products: true } } },
      })
    : await prisma.firm.findMany({
        where: { id: user.firmId ?? "" },
        include: { _count: { select: { users: true, branches: true, products: true } } },
      });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Firms"
        description={
          platformAdmin
            ? "Select a firm to operate in — its data, users and access modes"
            : "Your firm's registration profile"
        }
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
              {firm.gstin ? <p className="font-mono text-xs">GSTIN {firm.gstin}</p> : <p className="text-xs text-warning">No GSTIN — non-GST billing only</p>}
              <p className="text-xs text-muted-foreground">
                {firm.city}, {firm.state} · FY {firm.financialYear}
              </p>
              <p className="text-xs text-muted-foreground">
                {firm._count.users} users · {firm._count.branches} branches · {firm._count.products} products
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">Created {formatDate(firm.createdAt)}</span>
                {platformAdmin ? (
                  user.activeFirmId === firm.id ? (
                    <Badge tone="success">Operating here</Badge>
                  ) : (
                    <EnterFirmButton firmId={firm.id} firmName={firm.displayName || firm.name} disabled={firm.status !== "ACTIVE"} />
                  )
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
