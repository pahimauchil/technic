"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

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
import { cn } from "@/lib/utils";
import { switchAccessMode } from "@/app/(app)/access-mode-actions";
import type { TaxMode } from "@/generated/prisma/enums";

interface AccessModeSwitcherProps {
  mode: TaxMode;
  canSwitch: boolean;
}

/**
 * The GST / Non-GST mode indicator in the topbar. Escalating to GST requires
 * a valid firm access code — validated on the server by switchAccessMode,
 * which also rate-limits and locks out repeated failures. Platform admins
 * may switch without a code (they administer the codes themselves).
 */
export function AccessModeSwitcher({ mode, canSwitch }: AccessModeSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isGst = mode === "GST";

  function requestGst() {
    setError(null);
    startTransition(async () => {
      const result = await switchAccessMode({ code });
      if (result.ok) {
        setOpen(false);
        setCode("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function switchToNonGst() {
    setError(null);
    startTransition(async () => {
      const result = await switchAccessMode({});
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex shrink-0 items-center">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            onClick={() => (isGst || !canSwitch ? undefined : setOpen(true))}
            className={cn(
              "group flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition",
              isGst
                ? "border-[#1f7a45]/30 bg-[#1f7a45]/10 text-[#1f7a45]"
                : "border-border bg-muted text-muted-foreground",
              !isGst && canSwitch && "hover:border-[#123524]/40 hover:text-[#123524]",
            )}
            title={
              isGst
                ? "Operating in GST mode"
                : canSwitch
                  ? "Enter a GST access code to enable GST billing"
                  : "Non-GST mode (ask an admin for a GST access code)"
            }
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isGst ? "bg-[#1f7a45]" : "bg-muted-foreground/60",
              )}
              aria-hidden
            />
            {isGst ? "GST" : "Non-GST"}
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-warning" />
              Enter GST access code
            </DialogTitle>
            <DialogDescription>
              GST billing, tax fields and GST reports unlock only after a valid
              GST access code for this firm is entered. Repeated failures lock
              attempts temporarily.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="TECH-GST-XXXX"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                requestGst();
              }
            }}
          />
          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={switchToNonGst} disabled={pending}>
              Switch to Non-GST
            </Button>
            <Button onClick={requestGst} disabled={pending || code.trim().length < 4}>
              {pending ? "Checking…" : "Unlock GST mode"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
