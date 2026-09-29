import Link from "next/link";
import { Building2 } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { CreateFirmDialog } from "@/app/(app)/firms/firm-dialogs";
import { EnterFirmButton } from "@/app/(app)/firms/enter-firm-button";

export const metadata = { title: "Firms" };

interface FirmRow {
  id: string;
  code: string;
  name: string;
  city: string | null;
  status: string;
  branches: number;
  users: number;
  createdAt: Date;
}

export default async function FirmsPage() {
  await requirePermission(PERMISSIONS.FIRM_VIEW);

  const firms = await prisma.firm.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { branches: true, users: true } } },
  });

  const rows: FirmRow[] = firms.map((firm) => ({
    id: firm.id,
    code: firm.code,
    name: firm.name,
    city: firm.city,
    status: firm.status,
    branches: firm._count.branches,
    users: firm._count.users,
    createdAt: firm.createdAt,
  }));

  const columns: Column<FirmRow>[] = [
    {
      key: "name",
      header: "Firm",
      cell: (row) => (
        <div className="min-w-0">
          <Link href={`/firms/${row.id}`} className="font-medium hover:underline">
            {row.name}
          </Link>
          <p className="text-xs text-muted-foreground font-mono">{row.code}</p>
        </div>
      ),
    },
    {
      key: "city",
      header: "City",
      cell: (row) => row.city ?? "—",
      hideOnMobile: true,
    },
    {
      key: "branches",
      header: "Branches",
      cell: (row) => row.branches,
      hideOnMobile: true,
    },
    {
      key: "users",
      header: "Users",
      cell: (row) => row.users,
      hideOnMobile: true,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <EnterFirmButton firmId={row.id} firmName={row.name} disabled={row.status !== "ACTIVE"} />
          <Button asChild variant="outline" size="sm">
            <Link href={`/firms/${row.id}`}>Manage</Link>
          </Button>
        </div>
      ),
      className: "text-right",
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Firms"
        description="Every organization running on this ERP. Each firm's data — orders, customers, staff, finances — is completely isolated from every other firm's."
        actions={<CreateFirmDialog />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No firms yet"
          description="Add the first firm to get started."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
        />
      )}
    </div>
  );
}
