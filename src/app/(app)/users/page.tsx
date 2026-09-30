import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { NewUserButton } from "./new-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/rbac";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Users — Technic Technologies" };

export default async function UsersPage() {
  const user = await requirePermissionInFirm("users.view");

  const users = await prisma.user.findMany({
    where: { firmId: user.activeFirmId },
    orderBy: { employeeCode: "asc" },
    include: { branch: { select: { name: true } } },
  });

  interface Row {
    id: string;
    code: string | null;
    name: string;
    email: string;
    role: string;
    branch: string | null;
    status: string;
    lastLoginAt: Date | null;
  }
  const rows: Row[] = users.map((entry) => ({
    id: entry.id,
    code: entry.employeeCode,
    name: entry.name,
    email: entry.email,
    role: entry.role,
    branch: entry.branch?.name ?? null,
    status: entry.status,
    lastLoginAt: entry.lastLoginAt,
  }));

  const columns: Column<Row>[] = [
    { key: "name", header: "Name", cell: (row) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.name}</p>
        <p className="truncate text-xs text-muted-foreground">{row.email}</p>
      </div>
    ) },
    { key: "code", header: "Emp #", hideOnMobile: true, cell: (row) => <span className="numeric">{row.code ?? "—"}</span> },
    { key: "role", header: "Role", cell: (row) => <Badge tone="info">{ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? row.role}</Badge> },
    { key: "branch", header: "Branch", hideOnMobile: true, cell: (row) => row.branch ?? "—" },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} label={row.status.charAt(0) + row.status.slice(1).toLowerCase()} dot /> },
    { key: "lastLogin", header: "Last login", hideOnMobile: true, cell: (row) => <span className="numeric text-xs">{row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "Never"}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description={`${rows.length} accounts — each signs in with a personal 6-digit access code`}
        actions={user.permissions.includes("users.manage") ? <NewUserButton /> : null}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        renderMobileCard={(row) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="truncate font-medium">{row.name}</span>
              <Badge tone="info">{ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? row.role}</Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">{row.email} · {row.branch ?? "—"}</p>
          </div>
        )}
      />
    </div>
  );
}
