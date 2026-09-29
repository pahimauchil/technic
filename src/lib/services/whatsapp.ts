import "server-only";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { formatWhatsAppPhone, interpolateWhatsAppTemplate } from "@/lib/whatsapp-templates";
import type { WhatsAppMessageStatus, WhatsAppMessageType } from "@/generated/prisma/client";

export { formatWhatsAppPhone, interpolateWhatsAppTemplate };

// Server-only OpenWA environment configuration
const OPENWA_BASE_URL = (process.env.OPENWA_BASE_URL || process.env.OPENWA_API_URL || "http://localhost:8080").replace(/\/$/, "");
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || "aurclean_secret_key";
const CONFIG_SESSION_ID = process.env.OPENWA_SESSION_ID || process.env.OPENWA_SESSION || null;

/**
 * Maps an OpenWA HTTP status code to a message staff can act on, so a 401
 * (bad API key) doesn't read the same as a 429 (rate limited, try again) or
 * a 500 (gateway's own fault). Falls back to whatever the gateway itself
 * said, since that's more specific than a generic per-code message.
 */
function describeOpenWaError(status: number, gatewayMessage?: string | null): string {
  switch (status) {
    case 401:
    case 403:
      return "WhatsApp gateway authentication failed. Check the configured OpenWA API key.";
    case 404:
      return "WhatsApp session not found on the gateway. It may need to be reconnected.";
    case 409:
      return "WhatsApp session is not ready. Connect WhatsApp in Settings before sending.";
    case 413:
      return "Document is too large to send over WhatsApp.";
    case 429:
      return "WhatsApp gateway rate limit reached. Please try again shortly.";
    case 500:
      return "WhatsApp gateway encountered an internal error.";
    case 503:
    case 504:
      return "WhatsApp gateway is unreachable. Confirm the OpenWA service is running.";
    default:
      return gatewayMessage || `WhatsApp gateway returned an unexpected error (HTTP ${status}).`;
  }
}

export type OpenWaSessionStatus =
  | "initializing"
  | "qr_ready"
  | "authenticating"
  | "ready"
  | "disconnected"
  | "failed"
  | "action_required"
  | "openwa_unavailable"
  | "erp_unavailable";

export interface SendWhatsAppParams {
  firmId: string;
  phone: string;
  messageType: WhatsAppMessageType;
  messageText: string;
  customerId?: string;
  orderId?: string;
  documentName?: string;
  documentBase64?: string;
  sentByUserId?: string;
}

export interface WhatsAppStatusResponse {
  success: boolean;
  provider: "openwa";
  connected: boolean;
  status: OpenWaSessionStatus;
  phoneNumber: string | null;
  sessionId: string | null;
  qrCode: string | null;
  erpOk: boolean;
  openWaOk: boolean;
  error: string | null;
  lastCheckedAt: string;
  openWaUrl: string;
}

/** Default message templates for AURCLEAN ERP */
const DEFAULT_TEMPLATES: Record<WhatsAppMessageType, { name: string; body: string }> = {
  ORDER_CREATED: {
    name: "Order Confirmation",
    body: "Hi {{customerName}},\n\nThank you for choosing {{businessName}}. Your order #{{orderId}} has been placed successfully.\nTotal Amount: {{total}}\nExpected Delivery: {{deliveryDate}}\n\nThank you,\n{{businessName}}",
  },
  ORDER_READY: {
    name: "Order Ready Notification",
    body: "Hi {{customerName}},\n\nYour {{businessName}} laundry order #{{orderId}} is ready for collection.\n\nTotal: {{total}}\nPaid: {{paid}}\nBalance Due: {{balance}}\n\nThank you,\n{{businessName}}",
  },
  PAYMENT_RECEIVED: {
    name: "Payment Receipt",
    body: "Hi {{customerName}},\n\nPayment Received for Order #{{orderId}}.\nAmount Paid: {{paid}}\nRemaining Balance: {{balance}}\n\nThank you for your payment,\n{{businessName}}",
  },
  PAYMENT_PENDING: {
    name: "Payment Reminder",
    body: "Hi {{customerName}},\n\nReminder: Your {{businessName}} order #{{orderId}} has an outstanding balance of {{balance}}.\n\nPlease complete payment at your earliest convenience.\n\nThank you,\n{{businessName}}",
  },
  ORDER_DELIVERED: {
    name: "Delivery Confirmation",
    body: "Hi {{customerName}},\n\nYour order #{{orderId}} has been delivered successfully. Thank you for using {{businessName}}!\n\nWe hope to serve you again soon.",
  },
  INVOICE: {
    name: "WhatsApp Invoice",
    body: "Hi {{customerName}},\n\nThank you for choosing {{businessName}}.\n\nInvoice #{{invoiceNumber}}\nOrder #{{orderId}}\nTotal: {{total}}\nPaid: {{paid}}\nBalance: {{balance}}\n\nPlease find your invoice attached.\n\nThank you,\n{{businessName}}",
  },
  PAYMENT_RECEIPT: {
    name: "WhatsApp Payment Receipt",
    body: "Hi {{customerName}},\n\nPayment Receipt #{{invoiceNumber}}\nOrder #{{orderId}}\nAmount Paid: {{paid}}\nRemaining Balance: {{balance}}\n\nPlease find your payment receipt attached.\n\nThank you,\n{{businessName}}",
  },
  DELIVERY_RECEIPT: {
    name: "WhatsApp Delivery Receipt",
    body: "Hi {{customerName}},\n\nDelivery Receipt for Order #{{orderId}}.\nTotal Amount: {{total}}\nBalance: {{balance}}\n\nPlease find your delivery receipt attached.\n\nThank you for choosing {{businessName}}",
  },
  DELIVERY_CHALLAN: {
    name: "WhatsApp Delivery Challan",
    body: "Hello {{customerName}},\n\nPlease find your AURCLEAN Delivery Challan attached.\n\nChallan No: {{challanNumber}}\nOrder No: {{orderId}}\nDelivery Date: {{deliveryDate}}\n\nThank you,\nAURCLEAN\nThe Organic Laundry",
  },
  CUSTOM: {
    name: "Custom Message",
    body: "Hi {{customerName}},\n\n{{messageText}}\n\nRegards,\n{{businessName}}",
  },
};

/**
 * Executes a secure server-side HTTP fetch call to OpenWA API
 */
async function fetchOpenWa(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "DELETE" | "PUT";
    body?: any;
    timeoutMs?: number;
  } = {},
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = endpoint.startsWith("http") ? endpoint : `${OPENWA_BASE_URL}${endpoint}`;

  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": OPENWA_API_KEY,
        Authorization: `Bearer ${OPENWA_API_KEY}`,
        "api-key": OPENWA_API_KEY,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timer);

    const text = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        error: data?.message || data?.error || data?.reason || `HTTP ${res.status}`,
      };
    }

    return { ok: true, status: res.status, data };
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      return { ok: false, status: 504, data: null, error: `OpenWA request timeout (${timeoutMs}ms)` };
    }
    return { ok: false, status: 503, data: null, error: err?.message || "Unable to connect to OpenWA service" };
  }
}

/**
 * Resolves active OpenWA session ID dynamically or from env
 */
async function resolveOpenWaSessionId(): Promise<{ sessionId: string | null; openWaOk: boolean; error?: string }> {
  if (CONFIG_SESSION_ID) {
    return { sessionId: CONFIG_SESSION_ID, openWaOk: true };
  }

  // Session discovery via OpenWA sessions endpoint
  const res = await fetchOpenWa("/api/sessions", { timeoutMs: 4000 });
  if (!res.ok) {
    // Check root health endpoint as fallback
    const health = await fetchOpenWa("/api/health", { timeoutMs: 3000 });
    if (!health.ok && res.status === 503) {
      return { sessionId: null, openWaOk: false, error: "OpenWA service is unavailable" };
    }
    return { sessionId: "aurclean_session", openWaOk: true };
  }

  const sessions = Array.isArray(res.data) ? res.data : res.data?.sessions || [];
  if (sessions.length > 0) {
    const active = sessions.find((s: any) => s.status === "ready" || s.state === "CONNECTED" || s.status === "working") || sessions[0];
    const id = active?.sessionId || active?.id || active?.name || "aurclean_session";
    return { sessionId: id, openWaOk: true };
  }

  return { sessionId: "aurclean_session", openWaOk: true };
}

/**
 * Queries real-time session status directly from OpenWA and updates local DB cache
 */
export async function getWhatsAppStatus(firmId: string, options?: { forceRefresh?: boolean }): Promise<WhatsAppStatusResponse> {
  const now = new Date().toISOString();

  // Step 1: Verify ERP Database Connectivity
  let erpOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    erpOk = true;
  } catch {
    erpOk = false;
  }

  if (!erpOk) {
    return {
      success: false,
      provider: "openwa",
      connected: false,
      status: "erp_unavailable",
      phoneNumber: null,
      sessionId: CONFIG_SESSION_ID,
      qrCode: null,
      erpOk: false,
      openWaOk: false,
      error: "ERP database connection failure",
      lastCheckedAt: now,
      openWaUrl: OPENWA_BASE_URL,
    };
  }

  // Step 2: Resolve OpenWA session ID & test OpenWA reachability
  const discovery = await resolveOpenWaSessionId();
  if (!discovery.openWaOk) {
    const fallbackSessionName = CONFIG_SESSION_ID || "aurclean_session";
    await prisma.whatsAppSession.upsert({
      where: { firmId_sessionName: { firmId, sessionName: fallbackSessionName } },
      create: { firmId, sessionName: fallbackSessionName, isConnected: false, apiStatus: "OPENWA_UNAVAILABLE" },
      update: { isConnected: false, apiStatus: "OPENWA_UNAVAILABLE", connectedNumber: null, qrCode: null },
    }).catch(() => null);

    return {
      success: true,
      provider: "openwa",
      connected: false,
      status: "openwa_unavailable",
      phoneNumber: null,
      sessionId: discovery.sessionId,
      qrCode: null,
      erpOk: true,
      openWaOk: false,
      error: `Unable to connect to OpenWA service at ${OPENWA_BASE_URL}`,
      lastCheckedAt: now,
      openWaUrl: OPENWA_BASE_URL,
    };
  }

  const sessionId = discovery.sessionId || "aurclean_session";

  // Step 3: Fetch real session status from OpenWA API
  let rawStatus = "";
  let rawPhone: string | null = null;
  let rawQr: string | null = null;
  let rawError: string | null = null;

  const sessionRes = await fetchOpenWa(`/api/sessions/${sessionId}`, { timeoutMs: 5000 });
  let responseData = sessionRes.data;

  if (!sessionRes.ok) {
    const altRes = await fetchOpenWa("/api/session/status", { timeoutMs: 5000 });
    if (!altRes.ok && sessionRes.status === 503) {
      return {
        success: true,
        provider: "openwa",
        connected: false,
        status: "openwa_unavailable",
        phoneNumber: null,
        sessionId,
        qrCode: null,
        erpOk: true,
        openWaOk: false,
        error: `OpenWA service at ${OPENWA_BASE_URL} is unreachable`,
        lastCheckedAt: now,
        openWaUrl: OPENWA_BASE_URL,
      };
    } else if (altRes.ok) {
      responseData = altRes.data;
    }
  }

  // Normalize real status returned by OpenWA across different implementations
  if (responseData) {
    rawStatus = String(
      responseData.status ||
      responseData.state ||
      responseData.sessionStatus ||
      responseData.session ||
      (responseData.isLoggedIn ? "ready" : "") ||
      ""
    ).toLowerCase();

    const phoneRaw =
      responseData.phoneNumber ||
      responseData.phone ||
      responseData.me?.id ||
      responseData.me?.number ||
      responseData.accountInfo?.phoneNumber ||
      null;

    if (phoneRaw && typeof phoneRaw === "string") {
      const cleanDigits = phoneRaw.replace(/@c\.us/g, "").replace(/\D/g, "");
      if (cleanDigits) {
        rawPhone = cleanDigits.length === 10 ? `+91 ${cleanDigits}` : `+${cleanDigits}`;
      }
    }

    rawQr = responseData.qrCode || responseData.qr || responseData.base64 || null;
    if (rawQr && typeof rawQr === "string" && !rawQr.startsWith("data:")) {
      rawQr = `data:image/png;base64,${rawQr}`;
    }
  }

  if ((rawStatus === "qr_ready" || rawStatus === "qr_waiting" || rawStatus === "unpaired") && !rawQr) {
    const qrRes = await fetchOpenWa(`/api/sessions/${sessionId}/qr`, { timeoutMs: 5000 });
    if (qrRes.ok && qrRes.data) {
      const qrVal = qrRes.data.qrCode || qrRes.data.qr || qrRes.data.base64 || qrRes.data.image || null;
      if (qrVal && typeof qrVal === "string") {
        rawQr = qrVal.startsWith("data:") ? qrVal : `data:image/png;base64,${qrVal}`;
      }
    } else {
      rawError = "Unable to generate WhatsApp QR code from OpenWA API";
    }
  }

  // Exact-match set, not substring matching: rawStatus.includes("connected")
  // is true for "disconnected" (and .includes("active") is true for
  // "inactive", .includes("ready") is true for "not_ready"), so a naive
  // substring check misreports the gateway's own default disconnected state
  // as connected. Normalize away separators and compare the WHOLE status
  // string against known exact connected values instead.
  const connectedStatuses = new Set([
    "ready",
    "connected",
    "paired",
    "working",
    "inchat",
    "islogged",
    "isloggedin",
    "loggedin",
    "authenticated",
    "online",
    "open",
  ]);
  const normalizedStatus = rawStatus.replace(/[^a-z0-9]/g, "");

  const isActuallyConnected =
    connectedStatuses.has(normalizedStatus) ||
    responseData?.isLoggedIn === true ||
    responseData?.connected === true ||
    responseData?.authenticated === true ||
    responseData?.state === "CONNECTED" ||
    responseData?.state === "CONNECTED_SESSION" ||
    responseData?.status === "CONNECTED" ||
    responseData?.sessionStatus === "WORKING";

  let mappedStatus: OpenWaSessionStatus = "disconnected";
  if (isActuallyConnected) {
    mappedStatus = "ready";
  } else if (rawStatus === "qr_ready" || rawStatus === "qr_waiting" || rawStatus === "unpaired" || rawQr) {
    mappedStatus = "qr_ready";
  } else if (rawStatus === "authenticating" || rawStatus === "pairing") {
    mappedStatus = "authenticating";
  } else if (rawStatus === "initializing" || rawStatus === "starting") {
    mappedStatus = "initializing";
  } else if (rawStatus === "action_required" || rawStatus === "requires_action") {
    mappedStatus = "action_required";
  } else if (rawStatus === "failed" || rawStatus === "error") {
    mappedStatus = "failed";
  } else {
    mappedStatus = "disconnected";
  }

  try {
    await prisma.whatsAppSession.upsert({
      where: { firmId_sessionName: { firmId, sessionName: sessionId } },
      create: {
        firmId,
        sessionName: sessionId,
        isConnected: isActuallyConnected,
        connectedNumber: isActuallyConnected ? rawPhone : null,
        qrCode: mappedStatus === "qr_ready" ? rawQr : null,
        apiStatus: mappedStatus.toUpperCase(),
        ...(isActuallyConnected ? { lastConnectedAt: new Date() } : {}),
      },
      update: {
        isConnected: isActuallyConnected,
        connectedNumber: isActuallyConnected ? rawPhone : null,
        qrCode: mappedStatus === "qr_ready" ? rawQr : null,
        apiStatus: mappedStatus.toUpperCase(),
        ...(isActuallyConnected ? { lastConnectedAt: new Date() } : {}),
      },
    });
  } catch (err: any) {
    console.warn("Prisma session cache sync note:", err?.message);
  }

  return {
    success: true,
    provider: "openwa",
    connected: isActuallyConnected,
    status: mappedStatus,
    phoneNumber: isActuallyConnected ? rawPhone : null,
    sessionId,
    qrCode: mappedStatus === "qr_ready" ? rawQr : null,
    erpOk: true,
    openWaOk: true,
    error: rawError,
    lastCheckedAt: now,
    openWaUrl: OPENWA_BASE_URL,
  };
}

/**
 * Initiates a REAL session connection request to OpenWA API
 */
export async function connectWhatsAppSession(firmId: string): Promise<WhatsAppStatusResponse> {
  const discovery = await resolveOpenWaSessionId();
  const sessionId = discovery.sessionId || "aurclean_session";

  const health = await fetchOpenWa("/api/health", { timeoutMs: 3000 });
  if (!health.ok) {
    const rootCheck = await fetchOpenWa("/", { timeoutMs: 3000 });
    if (!rootCheck.ok) {
      return getWhatsAppStatus(firmId, { forceRefresh: true });
    }
  }

  let startRes = await fetchOpenWa(`/api/sessions/${sessionId}/start`, { method: "POST", timeoutMs: 8000 });
  if (!startRes.ok) {
    startRes = await fetchOpenWa("/api/sessions", {
      method: "POST",
      body: { name: sessionId, sessionId },
      timeoutMs: 8000,
    });
  }

  if (!startRes.ok) {
    startRes = await fetchOpenWa("/api/session/start", {
      method: "POST",
      body: { session: sessionId },
      timeoutMs: 8000,
    });
  }

  return getWhatsAppStatus(firmId, { forceRefresh: true });
}

/**
 * Reconnects a session by logging it out then starting a fresh connection.
 * The gateway (scripts/openwa-server.mjs) does not implement a /restart
 * endpoint — only logout and start — so this composes those two real calls
 * instead of hitting a route that would 404.
 */
export async function reconnectWhatsAppSession(firmId: string): Promise<WhatsAppStatusResponse> {
  const discovery = await resolveOpenWaSessionId();
  const sessionId = discovery.sessionId || "aurclean_session";

  await fetchOpenWa(`/api/sessions/${sessionId}/logout`, { method: "POST", timeoutMs: 5000 });

  return connectWhatsAppSession(firmId);
}

/**
 * Disconnects / logs out active session from OpenWA API
 */
export async function disconnectWhatsAppSession(firmId: string): Promise<WhatsAppStatusResponse> {
  const discovery = await resolveOpenWaSessionId();
  const sessionId = discovery.sessionId || "aurclean_session";

  await fetchOpenWa(`/api/sessions/${sessionId}/logout`, { method: "POST", timeoutMs: 5000 });
  await fetchOpenWa(`/api/sessions/${sessionId}`, { method: "DELETE", timeoutMs: 5000 });

  try {
    await prisma.whatsAppSession.upsert({
      where: { firmId_sessionName: { firmId, sessionName: sessionId } },
      create: { firmId, sessionName: sessionId, isConnected: false, apiStatus: "DISCONNECTED", connectedNumber: null, qrCode: null },
      update: { isConnected: false, apiStatus: "DISCONNECTED", connectedNumber: null, qrCode: null },
    });
  } catch (err: any) {
    console.warn("DB logout update note:", err?.message);
  }

  return getWhatsAppStatus(firmId, { forceRefresh: true });
}

/**
 * Sends a real text or document WhatsApp message through OpenWA API
 */
export async function sendWhatsAppMessage(params: SendWhatsAppParams): Promise<{
  success: boolean;
  messageId: string;
  status: WhatsAppMessageStatus;
  whatsappWebUrl?: string;
  error?: string;
}> {
  const formattedPhone = formatWhatsAppPhone(params.phone);
  if (!formattedPhone) {
    throw new Error("Invalid phone number provided for WhatsApp message delivery.");
  }

  // Offered back on failure (and on success) so staff always have a manual
  // path — opens WhatsApp Web/App with the same message pre-filled — without
  // ever implying OpenWA itself sent anything it didn't.
  const whatsappWebUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(params.messageText)}`;

  // Verify real session status before sending — a send attempt against a
  // session that isn't "ready" is not a useful signal (the gateway rejects
  // it too, but with a less specific error), and skipping this check is what
  // let a session in "authenticating" silently fall through to "success".
  const current = await getWhatsAppStatus(params.firmId, { forceRefresh: true });
  if (!current.connected || current.status !== "ready") {
    throw new Error(
      `WhatsApp is not connected (Status: ${current.status}). Please connect WhatsApp in Settings. [FALLBACK_URL:${whatsappWebUrl}]`,
    );
  }

  const sessionId = current.sessionId || CONFIG_SESSION_ID || "aurclean_session";
  const recipientJid = `${formattedPhone}@c.us`;

  let externalId: string | null = null;
  let status: WhatsAppMessageStatus = "SENT";
  let errorMessage: string | null = null;

  const payload = params.documentBase64
    ? {
        to: formattedPhone,
        phone: formattedPhone,
        chatId: recipientJid,
        filename: params.documentName || "document.pdf",
        caption: params.messageText,
        file: params.documentBase64,
        base64: params.documentBase64,
      }
    : {
        to: formattedPhone,
        phone: formattedPhone,
        chatId: recipientJid,
        text: params.messageText,
        message: params.messageText,
      };

  // Only endpoints the gateway (scripts/openwa-server.mjs) actually
  // implements: the session-scoped route first, its documented top-level
  // alias as a fallback. Guessing at routes the gateway doesn't have just
  // burns time on 404s before the real one is tried.
  const endpoints = params.documentBase64
    ? [`/api/sessions/${sessionId}/files`, `/api/sendFile`]
    : [`/api/sessions/${sessionId}/messages`, `/api/sendText`];

  let sendRes: { ok: boolean; status: number; data: any; error?: string } = {
    ok: false,
    status: 404,
    data: null,
    error: "OpenWA Gateway endpoint not found",
  };

  for (const endpoint of endpoints) {
    sendRes = await fetchOpenWa(endpoint, {
      method: "POST",
      body: payload,
      timeoutMs: 12000,
    });
    if (sendRes.ok) break;
  }

  if (sendRes.ok) {
    const data = sendRes.data || {};
    externalId = data.id || data.messageId || data.msgId || null;
    // The gateway only confirms the message was handed to WhatsApp's servers
    // (its own response says "SENT") — not that the recipient's device has
    // received or read it. DELIVERED/READ are reserved for the webhook
    // handler to set if a real delivery/read receipt ever arrives.
    status = "SENT";
  } else {
    status = "FAILED";
    errorMessage = describeOpenWaError(sendRes.status, sendRes.error);
  }

  // Record immutable database audit log
  const log = await prisma.whatsAppLog.create({
    data: {
      phone: params.phone,
      messageType: params.messageType,
      messageText: params.messageText,
      documentName: params.documentName || null,
      documentUrl: params.documentName ? `/api/files/whatsapp/${params.documentName}` : null,
      status,
      externalId,
      errorMessage,
      customerId: params.customerId || null,
      orderId: params.orderId || null,
      sentByUserId: params.sentByUserId || null,
    },
  });

  if (params.sentByUserId) {
    await recordAudit({
      userId: params.sentByUserId,
      action: "WHATSAPP_MESSAGE_SENT",
      entity: "WhatsAppLog",
      entityId: log.id,
      summary: `Sent WhatsApp ${params.messageType} to ${params.phone} (${status})`,
    });
  }

  if (status === "FAILED") {
    throw new Error(
      `${errorMessage || "Failed to dispatch message via OpenWA Gateway."} [FALLBACK_URL:${whatsappWebUrl}]`,
    );
  }

  return {
    success: true,
    messageId: log.id,
    status: log.status,
    whatsappWebUrl,
  };
}

/** Retrieves or initializes templates in database */
export async function getWhatsAppTemplates(firmId: string) {
  const existing = await prisma.whatsAppTemplate.findMany({
    where: { firmId },
    orderBy: { code: "asc" },
  });

  if (existing.length === 0) {
    const seeded = await Promise.all(
      Object.entries(DEFAULT_TEMPLATES).map(([code, tpl]) =>
        prisma.whatsAppTemplate.create({
          data: {
            firmId,
            code: code as WhatsAppMessageType,
            name: tpl.name,
            body: tpl.body,
            isActive: true,
          },
        }),
      ),
    );
    return seeded;
  }

  return existing;
}

/** Saves/updates a message template */
export async function saveWhatsAppTemplate(firmId: string, code: WhatsAppMessageType, name: string, body: string) {
  return prisma.whatsAppTemplate.upsert({
    where: { firmId_code: { firmId, code } },
    create: {
      firmId,
      code,
      name,
      body,
      isActive: true,
    },
    update: {
      name,
      body,
      isActive: true,
    },
  });
}

/** Lists communication history logs for a customer or order */
export async function getWhatsAppHistory(params: {
  customerId?: string;
  orderId?: string;
  take?: number;
}) {
  return prisma.whatsAppLog.findMany({
    where: {
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.orderId ? { orderId: params.orderId } : {}),
    },
    orderBy: { sentAt: "desc" },
    take: params.take || 50,
    include: {
      sentByUser: { select: { id: true, name: true, role: true } },
      order: { select: { id: true, orderNumber: true } },
      customer: { select: { id: true, name: true, phone: true } },
    },
  });
}

/** Handles OpenWA Webhook status callbacks */
export async function handleWhatsAppWebhook(payload: {
  messageId?: string;
  externalId?: string;
  status?: string;
  event?: string;
}) {
  const extId = payload.externalId || payload.messageId;
  if (!extId) return { updated: false };

  let newStatus: WhatsAppMessageStatus = "DELIVERED";
  if (payload.status === "READ" || payload.event === "message_ack_read") {
    newStatus = "READ";
  } else if (payload.status === "FAILED" || payload.event === "message_failed") {
    newStatus = "FAILED";
  } else if (payload.status === "DELIVERED" || payload.event === "message_ack_delivered") {
    newStatus = "DELIVERED";
  }

  const result = await prisma.whatsAppLog.updateMany({
    where: { externalId: extId },
    data: { status: newStatus },
  });

  return { updated: result.count > 0, status: newStatus };
}
