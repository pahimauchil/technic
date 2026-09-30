"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { createAccessCode, updateAccessCode, rotateAccessCode } from "@/lib/services/access-codes";

export async function createAccessCodeAction(input: { type: "GST" | "NON_GST"; description?: string | null }) {
  return runAction(async () => {
    const user = await authorize("access_codes.manage");
    const firmId = requireFirmId(user);

    const result = await createAccessCode({
      firmId,
      type: input.type,
      description: input.description ?? null,
      createdById: user.id,
    });

    revalidatePath("/access-codes");
    return { code: result.code };
  });
}

export async function updateAccessCodeAction(input: {
  codeId: string;
  action: "enable" | "disable" | "rotate";
}) {
  return runAction(async () => {
    const user = await authorize("access_codes.manage");
    const firmId = requireFirmId(user);

    if (input.action === "rotate") {
      const result = await rotateAccessCode(firmId, input.codeId, user.id);
      revalidatePath("/access-codes");
      return { code: result.code };
    }

    await updateAccessCode(firmId, input.codeId, {
      isActive: input.action === "enable",
      userId: user.id,
    });
    revalidatePath("/access-codes");
    return { code: null };
  });
}
