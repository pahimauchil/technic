import { NextResponse } from "next/server";
import { handleWhatsAppWebhook } from "@/lib/services/whatsapp";

export const dynamic = "force-dynamic";

/** Secure Webhook Receiver for OpenWA events & status callbacks */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("x-api-key");
    const secret = process.env.OPENWA_API_KEY || "aurclean_secret_key";

    // Validate webhook authenticity
    if (authHeader && !authHeader.includes(secret) && authHeader !== secret) {
      return NextResponse.json({ error: "Unauthorized webhook caller" }, { status: 401 });
    }

    const payload = await req.json();
    const result = await handleWhatsAppWebhook(payload);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing error" },
      { status: 500 },
    );
  }
}
