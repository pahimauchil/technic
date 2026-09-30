"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { receiveGoodsAction } from "./actions";

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  purchasePrice: number;
  trackSerials: boolean;
}

interface SupplierOption {
  id: string;
  name: string;
}

interface Line {
  key: number;
  productId: string;
  quantity: number;
  unitPrice: number;
  serials: string;
}

let lineKey = 0;

export function NewPurchaseButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 0, productId: "", quantity: 1, unitPrice: 0, serials: "" }]);
  const [pending, startTransition] = useTransition();

  const loadOptions = async () => {
    if (suppliers.length > 0) return;
    const [suppliersRes, productsRes] = await Promise.all([
      fetch("/api/suppliers").then((r) => (r.ok ? r.json() : { suppliers: [] })),
      fetch("/api/products").then((r) => (r.ok ? r.json() : { products: [] })),
    ]);
    setSuppliers(suppliersRes.suppliers ?? []);
    setProducts(productsRes.products ?? []);
  };

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const setLine = (key: number, updates: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...updates } : line)));

  const addLine = () =>
    setLines((current) => [...current, { key: (lineKey += 1), productId: "", quantity: 1, unitPrice: 0, serials: "" }]);

  const submit = () => {
    startTransition(async () => {
      const result = await receiveGoodsAction({
        supplierId,
        supplierRef: supplierRef || null,
        paymentAmount: Number(paymentAmount) || undefined,
        lines: lines
          .filter((line) => line.productId)
          .map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            serialNumbers:
              productById.get(line.productId)?.trackSerials
                ? line.serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
                : undefined,
          })),
      });
      if (result.ok) {
        toast.success(`Goods received — bill ${result.data.invoiceNumber}`);
        setOpen(false);
        setLines([{ key: (lineKey += 1), productId: "", quantity: 1, unitPrice: 0, serials: "" }]);
        setPaymentAmount("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) void loadOptions(); }}>
      <DialogTrigger asChild>
        <Button><Truck /> Receive goods</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive goods &amp; book supplier bill</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Supplier *</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-ref">Supplier bill no.</Label>
            <Input id="sup-ref" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          {lines.map((line) => {
            const product = productById.get(line.productId);
            return (
              <div key={line.key} className="space-y-1.5 rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-2">
                  <Select
                    value={line.productId}
                    onValueChange={(value) => {
                      const next = productById.get(value);
                      setLine(line.key, { productId: value, unitPrice: next?.purchasePrice ?? 0 });
                    }}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Product" /></SelectTrigger>
                    <SelectContent>
                      {products.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name} ({option.sku})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-20 numeric" type="number" min="1" value={line.quantity}
                    onChange={(e) => setLine(line.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    aria-label="Quantity"
                  />
                  <Input
                    className="w-28 numeric" type="number" min="0" value={line.unitPrice}
                    onChange={(e) => setLine(line.key, { unitPrice: Number(e.target.value) || 0 })}
                    aria-label="Unit cost"
                  />
                  <Button size="icon-sm" variant="ghost" className="text-destructive"
                    onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))} aria-label="Remove">
                    <Trash2 />
                  </Button>
                </div>
                {product?.trackSerials ? (
                  <div>
                    <Label className="text-xs">Serial numbers ({line.quantity} needed)</Label>
                    <Textarea
                      className="mt-1 min-h-16 font-mono text-xs"
                      placeholder="One serial / IMEI per line"
                      value={line.serials}
                      onChange={(e) => setLine(line.key, { serials: e.target.value })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
          <Button size="sm" variant="outline" onClick={addLine}><Plus /> Add item</Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="po-pay">Payment now (₹, optional)</Label>
          <Input id="po-pay" className="numeric w-40" type="number" min="0" value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !supplierId || lines.every((l) => !l.productId)}>
            {pending ? "Receiving…" : "Receive & book bill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
