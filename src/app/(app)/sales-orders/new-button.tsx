"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";
import { formatCurrency } from "@/lib/money";
import { parseNumericInput, tidyAmountOnBlur, tidyQuantityOnBlur } from "@/lib/numeric-input";
import { createSalesOrderAction } from "./actions";

interface CustomerOption {
  id: string;
  name: string;
  phone: string;
}

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  sellingPrice: number;
}

interface Line {
  key: number;
  productId: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  quantity: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  unitPrice: string;
}

let lineKey = 0;

export function NewSalesOrderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 0, productId: "", quantity: "1", unitPrice: "0" }]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || customers.length > 0) return;
    Promise.all([
      fetch("/api/customers").then((r) => (r.ok ? r.json() : { customers: [] })),
      fetch("/api/products").then((r) => (r.ok ? r.json() : { products: [] })),
    ])
      .then(([customersRes, productsRes]) => {
        setCustomers(customersRes.customers ?? []);
        setProducts(productsRes.products ?? []);
      })
      .catch(() => {
        setCustomers([]);
        setProducts([]);
      });
  }, [open, customers.length]);

  const productById = new Map(products.map((p) => [p.id, p]));

  const customerOptions: SearchableOption[] = customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    hint: customer.phone,
  }));
  const productOptions: SearchableOption[] = products.map((product) => ({
    value: product.id,
    label: product.name,
    hint: `${product.sku} · ${formatCurrency(product.sellingPrice)}`,
  }));

  const setLine = (key: number, updates: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...updates } : line)));

  const addLine = () =>
    setLines((current) => [...current, { key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0" }]);

  const submit = () => {
    startTransition(async () => {
      const result = await createSalesOrderAction({
        customerId,
        expectedDate: expectedDate || null,
        notes: notes || null,
        lines: lines
          .filter((line) => line.productId)
          .map((line) => ({
            productId: line.productId,
            quantity: parseNumericInput(line.quantity),
            unitPrice: parseNumericInput(line.unitPrice),
            gstRate: 18,
          })),
      });
      if (result.ok) {
        toast.success(`Sales order ${result.data.orderNumber} created`);
        setOpen(false);
        setLines([{ key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0" }]);
        setCustomerId("");
        setExpectedDate("");
        setNotes("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const validLines = lines.filter((line) => line.productId);
  const total = validLines.reduce(
    (sum, line) => sum + parseNumericInput(line.quantity) * parseNumericInput(line.unitPrice),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New sales order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New sales order</DialogTitle>
          <DialogDescription>
            Reserve the customer&apos;s order now — it becomes an invoice when you bill it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Customer *</Label>
            <SearchableSelect
              ariaLabel="Customer"
              options={customerOptions}
              value={customerId}
              onValueChange={setCustomerId}
              placeholder="Search customer by name or phone…"
              emptyMessage="No customers match"
            />
          </div>

          <div className="space-y-2">
            <Label>Items *</Label>
            {lines.map((line) => {
              const product = productById.get(line.productId);
              return (
                <div key={line.key} className="space-y-1.5 rounded-lg border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <SearchableSelect
                      ariaLabel="Product"
                      className="flex-1"
                      options={productOptions}
                      value={line.productId}
                      onValueChange={(value) => {
                        const product = productById.get(value);
                        setLine(line.key, {
                          productId: value,
                          unitPrice: String(product?.sellingPrice ?? 0),
                        });
                      }}
                      placeholder="Search product…"
                      emptyMessage="No products match"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                      aria-label="Remove line"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <Label className="text-xs text-muted-foreground">Quantity</Label>
                      <Input
                        className="numeric h-8"
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                        onBlur={(e) => setLine(line.key, { quantity: tidyQuantityOnBlur(e.target.value) })}
                        aria-label="Quantity"
                      />
                    </div>
                    <div className="w-32">
                      <Label className="text-xs text-muted-foreground">Rate (₹)</Label>
                      <Input
                        className="numeric h-8"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) => setLine(line.key, { unitPrice: e.target.value })}
                        onBlur={(e) => setLine(line.key, { unitPrice: tidyAmountOnBlur(e.target.value) })}
                        aria-label="Rate"
                      />
                    </div>
                    <span className="numeric ml-auto pt-5 text-sm font-semibold">
                      {formatCurrency(parseNumericInput(line.quantity) * parseNumericInput(line.unitPrice))}
                    </span>
                  </div>
                </div>
              );
            })}
            <Button size="sm" variant="outline" onClick={addLine}>
              <Plus /> Add item
            </Button>
          </div>

          {validLines.length > 0 ? (
            <div className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium">
              <span>Order total</span>
              <span className="numeric">{formatCurrency(total)}</span>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="so-expected">Expected by (optional)</Label>
              <Input
                id="so-expected"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-notes">Notes (optional)</Label>
              <Input
                id="so-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Delivery instructions…"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !customerId || validLines.length === 0}
          >
            <ClipboardList /> {pending ? "Saving…" : "Create order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
