"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, PackagePlus, Plus, Trash2, UserPlus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/money";
import { parseNumericInput, tidyAmountOnBlur, tidyQuantityOnBlur } from "@/lib/numeric-input";
import {
  QuickAddCustomerDialog,
  QuickAddProductDialog,
  type QuickCustomer,
  type QuickProduct,
} from "@/components/shared/quick-add";
import { createQuotationAction } from "./actions";

interface ProductOption {
  id: string;
  name: string;
  subName?: string | null;
  sku: string;
  sellingPrice: number;
  gstRate: number;
  trackSerials: boolean;
}

interface CustomerOption {
  id: string;
  name: string;
  phone: string;
}

interface Line {
  key: number;
  productId: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  quantity: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  unitPrice: string;
  /** Raw input text — line discount percentage. */
  discount: string;
  trackSerials: boolean;
  serials: string[];
}

let lineKey = 0;

export function NewQuotationButton({ 
  taxMode: initialTaxMode, 
  canSwitchMode 
}: { 
  taxMode: "GST" | "NON_GST"; 
  canSwitchMode: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [taxMode, setTaxMode] = useState<"GST" | "NON_GST">(initialTaxMode);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 0, productId: "", quantity: "1", unitPrice: "0", discount: "0", trackSerials: false, serials: [] }]);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  /** The line the product was requested from, so the new product lands there. */
  const [addProductForLine, setAddProductForLine] = useState<number | null>(null);
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
    label: product.subName ? `${product.name} — ${product.subName}` : product.name,
    hint: `${product.sku} · ${formatCurrency(product.sellingPrice)}`,
  }));

  const setLine = (key: number, updates: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...updates } : line)));

  const addLine = () =>
    setLines((current) => [...current, { key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0", discount: "0", trackSerials: false, serials: [] }]);

  /** A product created from inside this dialog: select it without leaving or resetting anything. */
  const onProductCreated = (created: QuickProduct) => {
    setProducts((current) => [...current, { ...created }]);
    setLines((current) => {
      const target =
        current.find((line) => line.key === addProductForLine && !line.productId) ??
        current.find((line) => !line.productId);
      const filled: Partial<Line> = {
        productId: created.id,
        unitPrice: String(created.sellingPrice),
        trackSerials: created.trackSerials,
        serials: created.trackSerials ? [""] : [],
      };
      if (target) return current.map((line) => (line.key === target.key ? { ...line, ...filled } : line));
      return [
        ...current,
        { key: (lineKey += 1), quantity: "1", discount: "0", ...filled } as Line,
      ];
    });
    setAddProductForLine(null);
  };

  const onCustomerCreated = (created: QuickCustomer) => {
    setCustomers((current) => [...current, { id: created.id, name: created.name, phone: created.phone }]);
    setCustomerId(created.id);
  };

  const submit = () => {
    startTransition(async () => {
      const result = await createQuotationAction({
        customerId,
        taxMode,
        validUntil: validUntil || null,
        notes: notes || null,
        lines: lines
          .filter((line) => line.productId)
          .map((line) => {
            const product = productById.get(line.productId);
            return {
              productId: line.productId,
              quantity: parseNumericInput(line.quantity),
              unitPrice: parseNumericInput(line.unitPrice),
              discountPercent: parseNumericInput(line.discount) || 0,
              gstRate: product?.gstRate ?? 18,
              serialNumbers: line.trackSerials ? line.serials : undefined,
            };
          }),
      });
      if (result.ok) {
        toast.success(`Quotation ${result.data.quotationNumber} created`);
        setOpen(false);
        setLines([{ key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0", discount: "0", trackSerials: false, serials: [] }]);
        setCustomerId("");
        setValidUntil("");
        setNotes("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const validLines = lines.filter((line) => line.productId);
  const total = validLines.reduce(
    (sum, line) =>
      sum +
      parseNumericInput(line.quantity) *
        parseNumericInput(line.unitPrice) *
        (1 - Math.min(100, parseNumericInput(line.discount) || 0) / 100),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FileText /> New quotation
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create quotation</DialogTitle>
          <DialogDescription>
            An estimate you can convert to an invoice in one step.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Customer *</Label>
              <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setAddCustomerOpen(true)}>
                <UserPlus className="size-3" /> Add customer
              </Button>
            </div>
            <SearchableSelect
              ariaLabel="Customer"
              options={customerOptions}
              value={customerId}
              onValueChange={setCustomerId}
              placeholder="Search customer by name or phone…"
              emptyMessage="No customers match"
            />
          </div>

          {canSwitchMode && (
            <div className="flex items-center justify-between">
              <Label>Quotation type</Label>
              <Select value={taxMode} onValueChange={(value: "GST" | "NON_GST") => setTaxMode(value)}>
                <SelectTrigger className="h-8 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GST">Tax Invoice</SelectItem>
                  <SelectItem value="NON_GST">Non-Tax Invoice</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

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
                          trackSerials: product?.trackSerials ?? false,
                          serials: product?.trackSerials ? Array.from({ length: parseNumericInput(line.quantity) }, () => "") : [],
                        });
                      }}
                      placeholder="Search product…"
                      emptyMessage="No products match — use Add Product"
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
                        onBlur={(e) => {
                          const newQty = tidyQuantityOnBlur(e.target.value);
                          const newSerials = line.trackSerials
                            ? [...line.serials, ...Array.from({ length: Math.max(0, parseNumericInput(newQty) - line.serials.length) }, () => "")].slice(0, parseNumericInput(newQty))
                            : [];
                          setLine(line.key, { quantity: newQty, serials: newSerials });
                        }}
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
                    <div className="w-20">
                      <Label className="text-xs text-muted-foreground">Disc %</Label>
                      <Input
                        className="numeric h-8"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={line.discount}
                        onChange={(e) => setLine(line.key, { discount: e.target.value })}
                        aria-label="Discount percent"
                      />
                    </div>
                    <span className="numeric ml-auto pt-5 text-sm font-semibold">
                      {formatCurrency(
                        parseNumericInput(line.quantity) *
                          parseNumericInput(line.unitPrice) *
                          (1 - Math.min(100, parseNumericInput(line.discount) || 0) / 100),
                      )}
                    </span>
                  </div>
                  {line.trackSerials ? (
                    <div className="space-y-1.5">
                      {Array.from({ length: parseNumericInput(line.quantity) }, (_, index) => (
                        <Input
                          key={index}
                          className="h-8 font-mono text-xs"
                          placeholder={`Serial / IMEI ${index + 1}`}
                          value={line.serials[index] ?? ""}
                          onChange={(e) =>
                            setLine(line.key, {
                              serials: line.serials.map((s, i) => (i === index ? e.target.value : s)),
                            })
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus /> Add item
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAddProductForLine(lines.find((l) => !l.productId)?.key ?? null);
                  setAddProductOpen(true);
                }}
              >
                <PackagePlus /> Add Product
              </Button>
            </div>
          </div>

          {validLines.length > 0 ? (
            <div className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium">
              <span>Quotation total</span>
              <span className="numeric">{formatCurrency(total)}</span>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="quote-valid">Valid until (optional)</Label>
            <Input
              id="quote-valid"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quote-notes">Notes (optional)</Label>
            <Textarea
              id="quote-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the customer should know"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !customerId || validLines.length === 0}>
            {pending ? "Saving…" : "Create quotation"}
          </Button>
        </DialogFooter>
        <QuickAddProductDialog open={addProductOpen} onOpenChange={setAddProductOpen} onCreated={onProductCreated} />
        <QuickAddCustomerDialog open={addCustomerOpen} onOpenChange={setAddCustomerOpen} onCreated={onCustomerCreated} />
      </DialogContent>
    </Dialog>
  );
}
