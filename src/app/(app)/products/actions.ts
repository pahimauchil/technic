"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { createProduct } from "@/lib/services/products";

export async function createProductAction(
  input: Omit<import("@/lib/services/products").ProductInput, "firmId" | "userId">,
) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const product = await createProduct({
      ...input,
      firmId,
      userId: user.id,
    });

    revalidatePath("/products");
    revalidatePath("/inventory");
    return { id: product.id, name: product.name, sku: product.sku };
  });
}
