import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  PackageX,
  Receipt,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { dashboardMetrics } from "@/lib/services/dashboard";
import { requirePermissionInFirm } from "@/lib/session";
import { sessionAccessMode } from "@/lib/access-mode";
import { formatCompactCurrency, formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { INVOICE_STATUS_LABELS } from "@/lib/workflow";

export const metadata = { title: "Dashboard — Technic Technologies" };

export default async function DashboardPage() {
  const user = await requirePermissionInFirm("dashboard.view");
  const mode = sessionAccessMode(user);
  const metrics = await dashboardMetrics(user, mode);

  return (
    <div className="space-y-5">
      <LiveRefresh />
      <PageHeader
        title={`Good day, ${user.name.split(" ")[0]}`}
        description={`Business overview for ${user.activeFirmName} — ${mode === "GST" ? "GST" : "non-GST"} mode`}
        actions={
          <Button asChild>
            <Link href="/pos">
              <ShoppingBag /> New sale
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Today's sales"
          value={formatCompactCurrency(metrics.todaySales)}
          icon={TrendingUp}
          hint={`${metrics.todaySalesCount} invoice(s)`}
        />
        {mode === "GST" && metrics.todayGstSales !== null ? (
          <StatCard
            label="GST sales today"
            value={formatCompactCurrency(metrics.todayGstSales)}
            icon={Receipt}
            tone="info"
            hint="Tax invoices issued today"
          />
        ) : null}
        <StatCard
          label="Receivables"
          value={formatCompactCurrency(metrics.receivables)}
          icon={Wallet}
          tone="warning"
          href="/payments"
          hint="Customer outstanding"
        />
        <StatCard
          label="Payables"
          value={formatCompactCurrency(metrics.payables)}
          icon={Wallet}
          tone="danger"
          href="/purchases/bills"
          hint="Supplier outstanding"
        />
        <StatCard
          label="Low stock items"
          value={metrics.lowStock}
          icon={AlertTriangle}
          tone="warning"
          href="/inventory?low=1"
        />
        <StatCard
          label="Out of stock"
          value={metrics.outOfStock}
          icon={PackageX}
          tone="danger"
          href="/inventory?low=1"
        />
        <StatCard
          label="Expenses this month"
          value={formatCompactCurrency(metrics.expensesThisMonth)}
          icon={Wallet}
          href="/expenses"
        />
      </div>

      <RevenueChart
        data={metrics.salesSeries.map((point) => ({
          date: point.date,
          orders: 0,
          revenue: point.sales,
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent invoices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {metrics.recentInvoices.length === 0 ? (
              <EmptyState title="No invoices yet" description="Sales you raise will appear here." />
            ) : (
              metrics.recentInvoices.map((invoice) => (
                <Link
                  key={invoice.id}
                  href={`/invoices/${invoice.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-primary/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {invoice.invoiceNumber}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {invoice.kind === "TAX_INVOICE" ? "Tax Invoice" : "Bill"}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {invoice.customerName} · {formatDate(invoice.date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="numeric text-sm font-semibold">{formatCurrency(invoice.total)}</span>
                    <StatusBadge
                      status={invoice.status}
                      label={INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
                    />
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top products this month</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {metrics.topProducts.length === 0 ? (
              <EmptyState title="No sales recorded this month" />
            ) : (
              metrics.topProducts.map((product) => (
                <div
                  key={product.name}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.quantity} unit(s) sold</p>
                  </div>
                  <span className="numeric shrink-0 text-sm font-semibold">
                    {formatCurrency(product.revenue)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
