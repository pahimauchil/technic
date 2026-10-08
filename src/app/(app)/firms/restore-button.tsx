"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { restoreFirmAction } from "./actions";

interface RestoreFirmButtonProps {
  firmId: string;
  firmName: string;
}

export function RestoreFirmButton({ firmId, firmName }: RestoreFirmButtonProps) {
  const [pending, setPending] = useState(false);

  const handleRestore = async () => {
    setPending(true);
    try {
      const result = await restoreFirmAction({ firmId });
      if (result.ok) {
        toast.success(`${firmName} is back in service`);
        window.location.reload();
      } else {
        toast.error(result.error);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={handleRestore} disabled={pending}>
      <RotateCcw className="h-4 w-4" />
      {pending ? "Restoring..." : "Restore"}
    </Button>
  );
}
