import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { NewPurchaseButton } from "./new-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PURCHASE_ORDER_STATUS_LABELS } from "@/lib/workflow";

export const metadata = { title: "Purchase Orders — Technic Technologies" };

export default async function PurchasesPage() {
  const user = await requirePermissionInFirm("purchase.view");

  const orders = await prisma.purchaseOrder.findMany({
    where: { firmId: user.activeFirmId },
    orderBy: { orderDate: "desc" },
    take: 100,
    include: {
      supplier: { select: { name: true } },
      branch: { select: { name: true } },
    },
  });

  interface Row {
    id: string;
    number: string;
    supplier: string;
    date: Date;
    total: number;
    status: string;
  }
  const rows: Row[] = orders.map((order) => ({
    id: order.id,
    number: order.poNumber,
    supplier: order.supplier.name,
    date: order.orderDate,
    total: Number(order.total),
    status: order.status,
  }));

  const columns: Column<Row>[] = [
    { key: "number", header: "PO #", cell: (row) => <span className="font-medium">{row.number}</span> },
    { key: "supplier", header: "Supplier", cell: (row) => <span className="line-clamp-1">{row.supplier}</span> },
    { key: "date", header: "Date", hideOnMobile: true, cell: (row) => <span className="numeric">{formatDate(row.date)}</span> },
    { key: "total", header: "Total", headerClassName: "text-right", className: "text-right numeric", cell: (row) => formatCurrency(row.total) },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} label={PURCHASE_ORDER_STATUS_LABELS[row.status] ?? row.status} dot /> },
    {
      key: "pdf",
      header: "",
      headerClassName: "text-right",
      hideOnMobile: true,
      cell: (row) => (
        <a href={`/api/documents/purchase-order/${row.id}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
          PDF
        </a>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Orders"
        description="Orders to suppliers — receiving goods books stock and the payable"
        actions={user.permissions.includes("purchase.create") || user.permissions.includes("purchase.receive") ? <NewPurchaseButton /> : null}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No purchase orders yet" description="Create one to start receiving stock." />}
        renderMobileCard={(row) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.number}</span>
              <StatusBadge status={row.status} label={PURCHASE_ORDER_STATUS_LABELS[row.status] ?? row.status} />
            </div>
            <p className="text-sm text-muted-foreground">{row.supplier} · {formatDate(row.date)}</p>
            <p className="numeric text-sm font-semibold">{formatCurrency(row.total)}</p>
          </div>
        )}
      />
    </div>
  );
}
