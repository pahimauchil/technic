"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAccessCodeAction } from "./actions";

export function NewAccessCodeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("GST");
  const [description, setDescription] = useState("");
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await createAccessCodeAction({
        type: type as "GST" | "NON_GST",
        description: description || null,
      });
      if (result.ok) {
        setCreatedCode(result.data.code);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCreatedCode(null);
      }}
    >
      <DialogTrigger asChild>
        <Button><KeyRound /> New access code</Button>
      </DialogTrigger>
      <DialogContent>
        {createdCode ? (
          <>
            <DialogHeader>
              <DialogTitle>Code created — copy it now</DialogTitle>
              <DialogDescription>
                This is the only time the plain code is shown. Only its bcrypt hash is stored.
              </DialogDescription>
            </DialogHeader>
            <p className="rounded-lg border border-border bg-muted px-4 py-3 text-center font-mono text-lg font-bold tracking-wider">
              {createdCode}
            </p>
            <DialogFooter>
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(createdCode);
                  toast.success("Code copied");
                }}
              >
                Copy code
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New access code</DialogTitle>
              <DialogDescription>
                GST codes unlock tax-invoice billing; non-GST codes keep billing tax-free.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GST">GST (TECH-GST-…)</SelectItem>
                    <SelectItem value="NON_GST">Non-GST (TECH-NONGST-…)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ac-desc">Description</Label>
                <Input id="ac-desc" value={description} onChange={(event) => setDescription(event.target.value)}
                  placeholder="e.g. Counter 1 — festive batch" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button onClick={submit} disabled={pending}>{pending ? "Generating…" : "Generate code"}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
