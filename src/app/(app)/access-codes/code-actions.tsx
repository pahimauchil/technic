"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { updateAccessCodeAction } from "./actions";

export function CodeActionButton({
  codeId,
  action,
  label,
}: {
  codeId: string;
  action: "enable" | "disable" | "rotate";
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await updateAccessCodeAction({ codeId, action });
          if (result.ok) {
            toast.success(result.data.code ? `New code: ${result.data.code}` : `Code ${action}d`);
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {pending ? "…" : label}
    </Button>
  );
}
