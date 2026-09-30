"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { createCustomer } from "@/lib/services/partners";

export async function createCustomerAction(input: {
  name: string;
  phone: string;
  gstin?: string | null;
  city?: string | null;
  state?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize("customers.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    const customer = await createCustomer({
      firmId,
      branchId,
      name: input.name,
      phone: input.phone,
      gstin: input.gstin ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      userId: user.id,
    });

    revalidatePath("/customers");
    return { code: customer.code, id: customer.id };
  });
}
