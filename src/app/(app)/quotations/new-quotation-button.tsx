"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createQuotationAction } from "./actions";

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  sellingPrice: number;
}

interface CustomerOption {
  id: string;
  name: string;
  phone: string;
}

interface LineDraft {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export function NewQuotationButton({ taxMode }: { taxMode: "GST" | "NON_GST" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : { customers: [] }))
      .then((d) => setCustomers(d.customers ?? []))
      .catch(() => setCustomers([]));
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d) => setProducts(d.products ?? []))
      .catch(() => setProducts([]));
  }, [open]);

  const addLine = () => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        { productId: product.id, name: product.name, quantity: 1, unitPrice: product.sellingPrice },
      ];
    });
    setProductId("");
  };

  const submit = () => {
    startTransition(async () => {
      const result = await createQuotationAction({
        customerId,
        taxMode,
        validUntil: validUntil || null,
        notes: notes || null,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          gstRate: 18,
        })),
      });
      if (result.ok) {
        toast.success(`Quotation ${result.data.quotationNumber} created`);
        setOpen(false);
        setLines([]);
        setNotes("");
        setValidUntil("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FileText /> New quotation
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create quotation</DialogTitle>
          <DialogDescription>
            An estimate you can convert to an invoice in one step.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.phone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Items</Label>
            <div className="flex gap-2">
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a product to add" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · ₹{p.sellingPrice.toFixed(0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={addLine}>
                Add
              </Button>
            </div>
            {lines.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-border p-2 text-sm">
                {lines.map((l) => (
                  <div key={l.productId} className="flex items-center justify-between gap-2">
                    <span className="truncate">{l.name}</span>
                    <span className="numeric whitespace-nowrap">
                      ₹{l.unitPrice.toFixed(2)} × {l.quantity}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-1 font-medium">
                  <span>Total (before tax break-up)</span>
                  <span className="numeric">₹{total.toFixed(2)}</span>
                </div>
              </div>
            ) : null}
          </div>

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
          <Button onClick={submit} disabled={pending || !customerId || lines.length === 0}>
            {pending ? "Saving…" : "Create quotation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
