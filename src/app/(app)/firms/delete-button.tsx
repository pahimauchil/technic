"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
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

interface DeleteFirmButtonProps {
  firmId: string;
  firmName: string;
  recordCount: number;
}

export function DeleteFirmButton({ firmId, firmName, recordCount }: DeleteFirmButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const handleDelete = async () => {
    setPending(true);

    try {
      const response = await fetch(`/api/firms/${firmId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success("Firm deleted successfully");
        setOpen(false);
        window.location.reload();
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to delete firm");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete firm?</DialogTitle>
          <DialogDescription>
            This will permanently delete <strong>{firmName}</strong> and all its associated data. This action cannot be undone.
            {recordCount > 0 && (
              <div className="mt-2 text-destructive">
                Warning: This firm has {recordCount} associated records (users, branches, products). Deletion may fail due to data integrity constraints.
              </div>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleDelete} disabled={pending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {pending ? "Deleting..." : "Delete firm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
