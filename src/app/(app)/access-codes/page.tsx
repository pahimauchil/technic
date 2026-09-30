import { PageHeader } from "@/components/shared/page-header";
import { CodeActionButton } from "./code-actions";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { NewAccessCodeButton } from "./new-button";
import { listAccessCodes } from "@/lib/services/access-codes";
import { requirePermissionInFirm } from "@/lib/session";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Access Codes — Technic Technologies" };

export default async function AccessCodesPage() {
  const user = await requirePermissionInFirm("access_codes.manage");
  const codes = await listAccessCodes(user.activeFirmId);

  const columns: Column<(typeof codes)[number]>[] = [
    {
      key: "type",
      header: "Type",
      cell: (row) => (
        <Badge tone={row.type === "GST" ? "success" : "neutral"}>
          {row.type === "GST" ? "GST" : "Non-GST"}
        </Badge>
      ),
    },
    { key: "description", header: "Description", cell: (row) => <span className="line-clamp-1">{row.description ?? "—"}</span> },
    { key: "status", header: "Status", cell: (row) => (
      <StatusBadge status={row.isActive ? "ACTIVE" : "INACTIVE"} label={row.isActive ? "Active" : "Disabled"} dot />
    ) },
    { key: "uses", header: "Uses", headerClassName: "text-right", className: "text-right numeric", hideOnMobile: true, cell: (row) => row.useCount },
    { key: "lastUsed", header: "Last used", hideOnMobile: true, cell: (row) => <span className="numeric text-xs">{row.lastUsedAt ? formatDateTime(row.lastUsedAt) : "Never"}</span> },
    { key: "created", header: "Created", hideOnMobile: true, cell: (row) => <span className="numeric text-xs">{formatDateTime(row.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      headerClassName: "text-right",
      cell: (row) => <CodeActions codeId={row.id} isActive={row.isActive} />,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Access Codes"
        description="GST and non-GST entry codes — hashed with bcrypt, shown once at creation"
        actions={<NewAccessCodeButton />}
      />
      <DataTable
        columns={columns}
        rows={codes}
        getRowKey={(row) => row.id}
        renderMobileCard={(row) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Badge tone={row.type === "GST" ? "success" : "neutral"}>{row.type === "GST" ? "GST" : "Non-GST"}</Badge>
              <StatusBadge status={row.isActive ? "ACTIVE" : "INACTIVE"} label={row.isActive ? "Active" : "Disabled"} />
            </div>
            <p className="text-sm text-muted-foreground">{row.description ?? "No description"}</p>
            <p className="numeric text-xs text-muted-foreground">
              {row.useCount} uses · {row.lastUsedAt ? `last ${formatDateTime(row.lastUsedAt)}` : "never used"}
            </p>
            <CodeActions codeId={row.id} isActive={row.isActive} />
          </div>
        )}
      />
    </div>
  );
}

function CodeActions({ codeId, isActive }: { codeId: string; isActive: boolean }) {
  return (
    <div className="flex justify-end gap-1">
      <CodeActionButton codeId={codeId} action={isActive ? "disable" : "enable"} label={isActive ? "Disable" : "Enable"} />
      <CodeActionButton codeId={codeId} action="rotate" label="Rotate" />
    </div>
  );
}
