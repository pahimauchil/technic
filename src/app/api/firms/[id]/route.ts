import { NextResponse } from "next/server";

import { authorize } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authorize("firms.view");

    const { id } = await params;

    const firm = await prisma.firm.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        legalName: true,
        displayName: true,
        gstin: true,
        pan: true,
        addressLine: true,
        city: true,
        state: true,
        stateCode: true,
        pincode: true,
        phone: true,
        email: true,
        website: true,
        invoicePrefix: true,
        quotationPrefix: true,
        purchasePrefix: true,
        financialYear: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!firm) {
      return NextResponse.json({ error: "Firm not found" }, { status: 404 });
    }

    // Non-platform admins can only view their own firm
    if (user.role !== "PLATFORM_ADMIN" && user.firmId !== firm.id) {
      return NextResponse.json({ error: "You can only view your own firm" }, { status: 403 });
    }

    return NextResponse.json(firm);
  } catch (error) {
    console.error("Error fetching firm:", error);
    return NextResponse.json({ error: "Failed to fetch firm" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authorize("firms.manage");

    const { id } = await params;

    const firm = await prisma.firm.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            branches: true,
            products: true,
            customers: true,
            suppliers: true,
            invoices: true,
            purchaseInvoices: true,
          },
        },
      },
    });

    if (!firm) {
      return NextResponse.json({ error: "Firm not found" }, { status: 404 });
    }

    // Check if firm has any data - prevent deletion to avoid data loss
    const hasData =
      firm._count.users > 0 ||
      firm._count.branches > 0 ||
      firm._count.products > 0 ||
      firm._count.customers > 0 ||
      firm._count.suppliers > 0 ||
      firm._count.invoices > 0 ||
      firm._count.purchaseInvoices > 0;

    if (hasData) {
      return NextResponse.json(
        {
          error: "Cannot delete a firm that has existing records.",
          hasData: true,
        },
        { status: 400 }
      );
    }

    // Prevent deletion of the currently active firm
    if (user.activeFirmId === id) {
      return NextResponse.json(
        { error: "Cannot delete the firm you are currently operating in. Switch to another firm first." },
        { status: 400 }
      );
    }

    await prisma.firm.delete({
      where: { id },
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Error deleting firm:", error);
    return NextResponse.json({ error: "Failed to delete firm" }, { status: 500 });
  }
}
