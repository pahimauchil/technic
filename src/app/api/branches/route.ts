import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { errorStatus } from "@/lib/action-result";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.activeFirmId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const branches = await prisma.branch.findMany({
      where: { firmId: user.activeFirmId, isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ branches });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: errorStatus(error) });
  }
}
