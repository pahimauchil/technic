import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm, taxModeWhere, type SessionUser } from "@/lib/session";
import { canBillGst } from "@/lib/access-mode";
import { isPlatformRole } from "@/lib/rbac";
import { NewQuotationButton } from "./new-quotation-button";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { QUOTATION_STATUS_LABELS } from "@/lib/workflow";

export const metadata = { title: "Quotations — Technic Technologies" };

function quotationMode(user: SessionUser): "GST" | "NON_GST" {
  return user.permissions.includes("gst_reports.view") ? "GST" : "NON_GST";
}

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("quotation.view");
  const params = await searchParams;

  const QUOTATION_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"] as const;
  type QuotationStatusValue = (typeof QUOTATION_STATUSES)[number];
  const status = QUOTATION_STATUSES.includes(params.status as QuotationStatusValue)
    ? (params.status as QuotationStatusValue)
    : undefined;

  const quotations = await prisma.quotation.findMany({
    where: {
      firmId: user.activeFirmId,
      ...(status ? { status } : {}),
      ...taxModeWhere(user),
    },
    orderBy: { quotationDate: "desc" },
    take: 100,
    include: {
      customer: { select: { name: true } },
      branch: { select: { name: true } },
    },
  });

  interface Row {
    id: string;
    number: string;
    customer: string;
    date: Date;
    total: number;
    status: string;
    taxMode: string;
  }

  const rows: Row[] = quotations.map((quotation) => ({
    id: quotation.id,
    number: quotation.quotationNumber,
    customer: quotation.customer.name,
    date: quotation.quotationDate,
    total: Number(quotation.totalAmount),
    status: quotation.status,
    taxMode: quotation.taxMode,
  }));

  const columns: Column<Row>[] = [
    {
      key: "number",
      header: "Quotation #",
      cell: (row) => (
        <span className="font-medium">{row.number}</span>
      ),
    },
    { key: "customer", header: "Customer", cell: (row) => <span className="line-clamp-1">{row.customer}</span> },
    { key: "date", header: "Date", hideOnMobile: true, cell: (row) => <span className="numeric">{formatDate(row.date)}</span> },
    {
      key: "total",
      header: "Total",
      headerClassName: "text-right",
      className: "text-right numeric",
      cell: (row) => formatCurrency(row.total),
    },
    {
      key: "mode",
      header: "Mode",
      hideOnMobile: true,
      cell: (row) => <Badge tone={row.taxMode === "GST" ? "info" : "neutral"}>{row.taxMode === "GST" ? "GST" : "Bill"}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} label={QUOTATION_STATUS_LABELS[row.status] ?? row.status} dot />,
    },
    {
      key: "actions",
      header: "",
      headerClassName: "text-right",
      cell: (row) =>
        row.status !== "CONVERTED" && user.permissions.includes("quotation.convert") ? (
          <ConvertButton quotationId={row.id} />
        ) : null,
    },
  ];

  const canCreate = user.permissions.includes("quotation.create");
  const canSwitchMode = isPlatformRole(user.role);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quotations"
        description="Estimates you can convert to invoices in one step"
        actions={canCreate ? <NewQuotationButton taxMode={quotationMode(user)} canSwitchMode={canSwitchMode} /> : null}
      />

      <FilterBar
        showSearch={false}
        filters={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "DRAFT", label: "Draft" },
              { value: "SENT", label: "Sent" },
              { value: "ACCEPTED", label: "Accepted" },
              { value: "REJECTED", label: "Rejected" },
              { value: "EXPIRED", label: "Expired" },
              { value: "CONVERTED", label: "Converted" },
            ],
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No quotations yet" description="Use “New quotation” to create your first estimate." />}
        renderMobileCard={(row) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.number}</span>
              <StatusBadge status={row.status} label={QUOTATION_STATUS_LABELS[row.status] ?? row.status} />
            </div>
            <p className="text-sm text-muted-foreground">{row.customer}</p>
            <div className="flex items-center justify-between text-sm">
              <span>{formatDate(row.date)}</span>
              <span className="numeric font-semibold">{formatCurrency(row.total)}</span>
            </div>
            {row.status !== "CONVERTED" && user.permissions.includes("quotation.convert") ? (
              <ConvertButton quotationId={row.id} />
            ) : null}
          </div>
        )}
      />
    </div>
  );
}

function ConvertButton({ quotationId }: { quotationId: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={`/quotations/${quotationId}/convert`}>Convert</Link>
    </Button>
  );
}
