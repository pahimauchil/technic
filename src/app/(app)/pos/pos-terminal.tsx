"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Barcode, Minus, PackagePlus, Plus, ScanLine, Search, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { Separator } from "@/components/ui/separator";
import { QuickAddCustomerDialog, QuickAddProductDialog, type QuickCustomer, type QuickProduct } from "@/components/shared/quick-add";
import { checkoutAction } from "./actions";
import { formatCurrency } from "@/lib/money";
import { parseNumericInput, tidyAmountOnBlur, tidyQuantityOnBlur } from "@/lib/numeric-input";
import { cn } from "@/lib/utils";

interface PosProduct {
  id: string;
  name: string;
  subName?: string | null;
  sku: string;
  barcode: string | null;
  hsnCode: string | null;
  gstRate: number;
  sellingPrice: number;
  trackSerials: boolean;
  trackImei: boolean;
  brand: { name: string } | null;
  variants: { id: string; name: string; sku: string; sellingPrice: number }[];
}

interface PosCustomer {
  id: string;
  code: string;
  name: string;
  phone: string;
  gstin: string | null;
  state: string | null;
}

interface CartLine {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  quantity: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  unitPrice: string;
  /** Raw input text — line discount percentage. */
  discount: string;
  gstRate: number;
  trackSerials: boolean;
  serials: string[];
}

export function PosTerminal({
  mode: initialMode,
  products: initialProducts,
  customers: initialCustomers,
  canCollectPayment,
  canSwitchMode,
}: {
  mode: "GST" | "NON_GST";
  branchId: string;
  products: PosProduct[];
  customers: PosCustomer[];
  canCollectPayment: boolean;
  canSwitchMode: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"GST" | "NON_GST">(initialMode);
  const [products, setProducts] = useState<PosProduct[]>(initialProducts);
  const [customers, setCustomers] = useState<PosCustomer[]>(initialCustomers);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [pending, startTransition] = useTransition();

  const matches = useMemo(() => {
    const cleaned = query.trim().toLowerCase();
    if (!cleaned) return products.slice(0, 8);
    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(cleaned) ||
          (product.subName ?? "").toLowerCase().includes(cleaned) ||
          product.sku.toLowerCase().includes(cleaned) ||
          product.barcode === query.trim(),
      )
      .slice(0, 10);
  }, [products, query]);

  const addToCart = (product: PosProduct, variantId?: string) => {
    const variant = product.variants.find((v) => v.id === variantId);
    const key = `${product.id}:${variantId ?? "-"}`;
    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key
            ? { ...line, quantity: String(parseNumericInput(line.quantity) + 1) }
            : line,
        );
      }
      return [
        ...current,
        {
          key,
          productId: product.id,
          variantId: variantId ?? null,
          name: [variant ? `${product.name} — ${variant.name}` : product.name, product.subName].filter(Boolean).join(" · "),
          quantity: "1",
          unitPrice: String(variant?.sellingPrice ?? product.sellingPrice),
          discount: "0",
          gstRate: product.gstRate,
          trackSerials: product.trackSerials,
          serials: Array.from({ length: 1 }, () => ""),
        },
      ];
    });
  };

  /** Product created from the POS screen: add it to the catalogue and the cart, cart untouched otherwise. */
  const onProductCreated = (created: QuickProduct) => {
    const product: PosProduct = {
      id: created.id,
      name: created.name,
      subName: created.subName,
      sku: created.sku,
      barcode: null,
      hsnCode: created.hsnCode,
      gstRate: created.gstRate,
      sellingPrice: created.sellingPrice,
      trackSerials: created.trackSerials,
      trackImei: false,
      brand: null,
      variants: [],
    };
    setProducts((current) => [product, ...current]);
    addToCart(product);
  };

  const onCustomerCreated = (created: QuickCustomer) => {
    setCustomers((current) => [
      ...current,
      { id: created.id, code: created.code, name: created.name, phone: created.phone, gstin: created.gstin, state: created.state },
    ]);
    setCustomerId(created.id);
  };

  const customerOptions: SearchableOption[] = customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    hint: customer.phone,
  }));

  const totals = useMemo(() => {
    let subtotal = 0;
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    for (const line of cart) {
      const gross =
        parseNumericInput(line.unitPrice) *
        parseNumericInput(line.quantity) *
        (1 - Math.min(100, parseNumericInput(line.discount) || 0) / 100);
      subtotal += gross;
      const lineTaxable = mode === "GST" ? gross / (1 + line.gstRate / 100) : gross;
      taxable += lineTaxable;
      if (mode === "GST") {
        const tax = gross - lineTaxable;
        cgst += tax / 2;
        sgst += tax / 2;
      }
    }
    const total = Math.round(subtotal);
    return {
      subtotal,
      taxable,
      cgst,
      sgst,
      roundOff: total - subtotal,
      total,
    };
  }, [cart, mode]);

  const checkout = () => {
    if (!customerId) {
      toast.error("Select a customer first");
      return;
    }
    for (const line of cart) {
      if (line.trackSerials) {
        const serials = line.serials.map((s) => s.trim()).filter(Boolean);
        if (serials.length !== parseNumericInput(line.quantity)) {
          toast.error(`${line.name} needs ${parseNumericInput(line.quantity)} serial number(s)`);
          return;
        }
      }
    }
    startTransition(async () => {
      const result = await checkoutAction({
        customerId,
        lines: cart.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          quantity: parseNumericInput(line.quantity),
          unitPrice: parseNumericInput(line.unitPrice),
          discountPercent: parseNumericInput(line.discount) || 0,
          gstRate: mode === "GST" ? line.gstRate : 0,
          serialNumbers: line.trackSerials ? line.serials.map((s) => s.trim()).filter(Boolean) : undefined,
        })),
        paymentAmount: canCollectPayment ? Number(paymentAmount) || undefined : undefined,
        paymentMethod: paymentMethod as never,
        taxMode: mode,
      });
      if (result.ok) {
        toast.success(`Invoice ${result.data.invoiceNumber} created`);
        setCart([]);
        setPaymentAmount("");
        router.push(`/invoices/${result.data.invoiceId}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Catalogue */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Catalogue</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setAddProductOpen(true)}>
              <PackagePlus /> Add Product
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Scan barcode or search…"
              className="pl-8"
              autoFocus
            />
          </div>
        </CardHeader>
        <CardContent className="max-h-[480px] space-y-2 overflow-auto scrollbar-thin">
          {matches.map((product) => (
            <div key={product.id} className="rounded-lg border border-border p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{product.name}</p>
                  {product.subName ? <p className="truncate text-xs text-muted-foreground">{product.subName}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {product.sku}
                    {product.brand ? ` · ${product.brand.name}` : ""}
                    {product.trackSerials ? " · serialized" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="numeric text-sm font-semibold">{formatCurrency(product.sellingPrice)}</span>
                  {product.variants.length === 0 ? (
                    <Button size="icon-sm" variant="outline" onClick={() => addToCart(product)} aria-label="Add">
                      <Plus />
                    </Button>
                  ) : null}
                </div>
              </div>
              {product.variants.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {product.variants.map((variant) => (
                    <Button
                      key={variant.id}
                      size="sm"
                      variant="secondary"
                      onClick={() => addToCart(product, variant.id)}
                    >
                      <Plus className="size-3" /> {variant.name} · {formatCurrency(variant.sellingPrice)}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {matches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              <Barcode className="mx-auto mb-2 size-6" />
              No products match — scan a barcode or try another term.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Cart */}
      <Card className="lg:col-span-3">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Current sale</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setAddCustomerOpen(true)}>
              <UserPlus /> Add Customer
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
        </CardHeader>
        <CardContent className="space-y-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <ScanLine className="size-7" />
              <p className="text-sm">Cart is empty — add products from the catalogue.</p>
            </div>
          ) : (
            cart.map((line) => (
              <div key={line.key} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">{line.name}</p>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setCart((current) => current.filter((l) => l.key !== line.key))}
                    aria-label="Remove"
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() =>
                        setCart((current) =>
                          current.map((l) =>
                            l.key === line.key
                              ? { ...l, quantity: String(Math.max(1, parseNumericInput(l.quantity) - 1)) }
                              : l,
                          ),
                        )
                      }
                      aria-label="Decrease"
                    >
                      <Minus />
                    </Button>
                    <Input
                      className="h-8 w-14 text-center numeric"
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(event) =>
                        setCart((current) =>
                          current.map((l) =>
                            l.key === line.key ? { ...l, quantity: event.target.value } : l,
                          ),
                        )
                      }
                      onBlur={(event) =>
                        setCart((current) =>
                          current.map((l) =>
                            l.key === line.key
                              ? { ...l, quantity: tidyQuantityOnBlur(event.target.value) }
                              : l,
                          ),
                        )
                      }
                      aria-label="Quantity"
                    />
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() =>
                        setCart((current) =>
                          current.map((l) =>
                            l.key === line.key
                              ? { ...l, quantity: String(parseNumericInput(l.quantity) + 1) }
                              : l,
                          ),
                        )
                      }
                      aria-label="Increase"
                    >
                      <Plus />
                    </Button>
                  </div>
                  <Input
                    className="h-8 w-28 numeric"
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(event) =>
                      setCart((current) =>
                        current.map((l) =>
                          l.key === line.key ? { ...l, unitPrice: event.target.value } : l,
                        ),
                      )
                    }
                    onBlur={(event) =>
                      setCart((current) =>
                        current.map((l) =>
                          l.key === line.key ? { ...l, unitPrice: tidyAmountOnBlur(event.target.value) } : l,
                        ),
                      )
                    }
                    aria-label="Unit price"
                  />
                  <Input
                    className="h-8 w-20 numeric"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="Disc %"
                    value={line.discount}
                    onChange={(event) =>
                      setCart((current) =>
                        current.map((l) => (l.key === line.key ? { ...l, discount: event.target.value } : l)),
                      )
                    }
                    aria-label="Discount percent"
                  />
                  <span className="numeric ml-auto text-sm font-semibold">
                    {formatCurrency(
                      parseNumericInput(line.unitPrice) *
                        parseNumericInput(line.quantity) *
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
                        onChange={(event) =>
                          setCart((current) =>
                            current.map((l) => {
                              if (l.key !== line.key) return l;
                              const serials = [...l.serials];
                              while (serials.length < parseNumericInput(l.quantity)) serials.push("");
                              serials[index] = event.target.value;
                              return { ...l, serials };
                            }),
                          )
                        }
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}

          {cart.length > 0 ? (
            <>
              {canSwitchMode && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Invoice type</span>
                  <Select value={mode} onValueChange={(value: "GST" | "NON_GST") => setMode(value)}>
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
              <Separator />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="numeric">{formatCurrency(totals.subtotal)}</span></div>
                {mode === "GST" ? (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Taxable value</span><span className="numeric">{formatCurrency(totals.taxable)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="numeric">{formatCurrency(totals.cgst)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="numeric">{formatCurrency(totals.sgst)}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="numeric">Non-Tax</span></div>
                )}
                {totals.roundOff !== 0 ? (
                  <div className="flex justify-between"><span className="text-muted-foreground">Round off</span><span className="numeric">{formatCurrency(totals.roundOff)}</span></div>
                ) : null}
                <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                  <span>Total</span><span className="numeric">{formatCurrency(totals.total)}</span>
                </div>
              </div>

              {canCollectPayment ? (
                <div className="flex flex-wrap gap-2">
                  <Input
                    className="w-36 numeric"
                    placeholder="Amount received"
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                  />
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="w-36" aria-label="Payment method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE"].map((method) => (
                        <SelectItem key={method} value={method}>
                          {method.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <Button
                className={cn("w-full")}
                size="lg"
                onClick={checkout}
                disabled={pending || !customerId}
              >
                {pending ? "Billing…" : `Charge ${formatCurrency(totals.total)}`}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Invoice will be a {mode === "GST" ? "Tax Invoice" : "Non-Tax Invoice"}
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
      <QuickAddProductDialog open={addProductOpen} onOpenChange={setAddProductOpen} onCreated={onProductCreated} />
      <QuickAddCustomerDialog open={addCustomerOpen} onOpenChange={setAddCustomerOpen} onCreated={onCustomerCreated} />
    </div>
  );
}
