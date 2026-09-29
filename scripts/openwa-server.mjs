import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import QRCode from "qrcode";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";

/**
 * Native OpenWA REST API Gateway Server for AURCLEAN Laundry ERP
 * Powered by Baileys socket engine - 100% native Node.js implementation
 * Zero dependency on wmic.exe, Puppeteer, or native OS binaries.
 */

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.OPENWA_API_KEY || "aurclean_secret_key";
const SESSION_ID = process.env.OPENWA_SESSION_ID || process.env.OPENWA_SESSION || "aurclean_session";
const SESSION_NAME = SESSION_ID;
const AUTH_DIR = path.join(process.cwd(), "_whatsapp_auth");

let sock = null;
let status = "disconnected"; // disconnected | initializing | qr_ready | authenticating | ready | failed
let qrBase64 = null;
let phoneNumber = null;
let lastConnectedAt = null;

async function startWhatsAppSocket() {
  try {
    status = "initializing";
    console.log("⚡ [OpenWA Gateway] Initializing WhatsApp Web WebSocket connection...");

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    sock = makeWASocket({
      version,
      auth: state,
      // QR is handled below via the connection.update listener (rendered to
      // a data URL and served over the REST API) — printQRInTerminal is a
      // deprecated Baileys option that only logs the raw QR to the process's
      // own terminal and does nothing this server needs.
      browser: ["AURCLEAN ERP", "Chrome", "1.0.0"],
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        status = "qr_ready";
        try {
          qrBase64 = await QRCode.toDataURL(qr);
          console.log("\n📷 [OpenWA Gateway] Real WhatsApp QR Code issued! Scan with WhatsApp on your phone.\n");
        } catch (e) {
          console.warn("QR render error:", e);
        }
      }

      if (connection === "connecting") {
        if (status !== "qr_ready") status = "authenticating";
      }

      if (connection === "open") {
        status = "ready";
        qrBase64 = null;
        lastConnectedAt = new Date();
        const userJid = sock.user?.id || "";
        const rawNum = userJid.replace(/@c\.us|:.*$/g, "").replace(/\D/g, "");
        phoneNumber = rawNum ? (rawNum.length === 10 ? `+91 ${rawNum}` : `+${rawNum}`) : "Connected WhatsApp account";
        console.log(`\n🟢 [OpenWA Gateway] WhatsApp Connected successfully! Linked phone number: ${phoneNumber}\n`);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          status = "disconnected";
          phoneNumber = null;
          qrBase64 = null;
          try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
          console.log("\n🔴 [OpenWA Gateway] Logged out from WhatsApp Web.");
        } else {
          status = "disconnected";
          console.log(`\n🟡 [OpenWA Gateway] Connection closed (code ${statusCode || 'unknown'}). Auto-reconnecting...`);
          setTimeout(() => startWhatsAppSocket(), 4000);
        }
      }
    });
  } catch (err) {
    status = "failed";
    console.error("❌ [OpenWA Gateway] Socket initialization error:", err);
  }
}

function parseJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); }
    });
  });
}

function sendResponse(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, api-key",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, api-key",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const authHeader = req.headers["authorization"] || req.headers["x-api-key"] || req.headers["api-key"];

  const isAuthorized =
    !API_KEY ||
    (authHeader && (authHeader.includes(API_KEY) || authHeader === API_KEY)) ||
    url.searchParams.get("api_key") === API_KEY;

  if (!isAuthorized && url.pathname !== "/" && url.pathname !== "/health" && url.pathname !== "/api/health") {
    sendResponse(res, 401, { error: "Unauthorized: Invalid OpenWA API Key" });
    return;
  }

  // Health Endpoint
  if (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/api/health") {
    sendResponse(res, 200, {
      status: "ok",
      service: "OpenWA REST API Gateway for AURCLEAN ERP",
      sessionId: SESSION_NAME,
      sessionStatus: status,
      connected: status === "ready",
      port: PORT,
    });
    return;
  }

  // List Sessions Endpoint
  if (req.method === "GET" && url.pathname === "/api/sessions") {
    sendResponse(res, 200, [
      {
        sessionId: SESSION_NAME,
        status,
        phoneNumber,
        connected: status === "ready",
      },
    ]);
    return;
  }

  // Session Info Endpoint GET /api/sessions/{sessionId} or GET /api/session/status
  if (req.method === "GET" && (url.pathname === `/api/sessions/${SESSION_NAME}` || url.pathname === "/api/session/status" || url.pathname === "/status")) {
    sendResponse(res, 200, {
      success: true,
      sessionId: SESSION_NAME,
      status,
      state: status === "ready" ? "CONNECTED" : status.toUpperCase(),
      connected: status === "ready",
      phoneNumber,
      qrCode: status === "qr_ready" ? qrBase64 : null,
      me: status === "ready" && phoneNumber ? { id: phoneNumber.replace(/\D/g, "") + "@c.us", number: phoneNumber } : null,
      lastConnectedAt,
    });
    return;
  }

  // Fetch QR Code Endpoint GET /api/sessions/{sessionId}/qr or /getQr
  if (req.method === "GET" && (url.pathname === `/api/sessions/${SESSION_NAME}/qr` || url.pathname === "/getQr" || url.pathname === "/api/qr")) {
    if (status === "qr_ready" && qrBase64) {
      sendResponse(res, 200, {
        success: true,
        sessionId: SESSION_NAME,
        status: "qr_ready",
        qrCode: qrBase64,
        qr: qrBase64,
      });
    } else {
      sendResponse(res, 400, {
        success: false,
        error: status === "ready" ? "WhatsApp is already connected." : "QR code is not ready yet.",
        status,
      });
    }
    return;
  }

  // Start / Connect Session Endpoint POST /api/sessions/{sessionId}/start or POST /api/sessions
  if (req.method === "POST" && (url.pathname === `/api/sessions/${SESSION_NAME}/start` || url.pathname === "/api/sessions" || url.pathname === "/api/session/start")) {
    if (status === "disconnected" || status === "failed" || !sock) {
      startWhatsAppSocket();
    }
    sendResponse(res, 200, {
      success: true,
      sessionId: SESSION_NAME,
      status,
      message: "WhatsApp session connection initiated.",
    });
    return;
  }

  // Disconnect / Logout Endpoint DELETE /api/sessions/{sessionId} or POST /api/sessions/{sessionId}/logout
  if (req.method === "DELETE" || (req.method === "POST" && (url.pathname.includes("/logout") || url.pathname.includes("/terminate")))) {
    if (sock) {
      try { sock.logout(); } catch {}
      try { sock.end(); } catch {}
      sock = null;
    }
    status = "disconnected";
    phoneNumber = null;
    qrBase64 = null;
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
    console.log("🔴 [OpenWA Gateway] Session disconnected and auth state cleared.");

    sendResponse(res, 200, {
      success: true,
      sessionId: SESSION_NAME,
      status: "disconnected",
      message: "Session logged out.",
    });
    return;
  }

  // Send Text Message POST /api/sessions/{sessionId}/messages or POST /api/sendText
  if (req.method === "POST" && (url.pathname.includes("/messages") || url.pathname === "/api/sendText" || url.pathname === "/sendText")) {
    if (status !== "ready" || !sock) {
      sendResponse(res, 400, { success: false, error: `WhatsApp is not connected (Current Status: ${status})` });
      return;
    }

    const body = await parseJson(req);
    const rawTo = body.to || body.chatId || body.phone;
    const text = body.text || body.message || body.caption;

    if (!rawTo || !text) {
      sendResponse(res, 400, { success: false, error: "Missing required parameters: 'to' and 'text'" });
      return;
    }

    const digits = String(rawTo).replace(/\D/g, "");
    const formattedPhone = digits.length === 10 ? `91${digits}` : digits;
    const jid = `${formattedPhone}@s.whatsapp.net`;

    try {
      const result = await sock.sendMessage(jid, { text });
      const msgId = result?.key?.id || `WA-${Date.now()}`;
      console.log(`💬 [OpenWA Gateway] Sent real WhatsApp message to ${formattedPhone} (ID: ${msgId})`);

      sendResponse(res, 200, {
        success: true,
        id: msgId,
        messageId: msgId,
        to: formattedPhone,
        status: "SENT",
      });
    } catch (err) {
      console.error("❌ Send text error:", err);
      sendResponse(res, 500, { success: false, error: err?.message || "Failed to dispatch WhatsApp text message" });
    }
    return;
  }

  // Send Document / PDF File POST /api/sessions/{sessionId}/files or POST /api/sendFile
  if (req.method === "POST" && (url.pathname.includes("/files") || url.pathname === "/api/sendFile" || url.pathname === "/sendFile")) {
    if (status !== "ready" || !sock) {
      sendResponse(res, 400, { success: false, error: `WhatsApp is not connected (Current Status: ${status})` });
      return;
    }

    const body = await parseJson(req);
    const rawTo = body.to || body.chatId || body.phone;
    const filename = body.filename || "document.pdf";
    const caption = body.caption || body.text || "";
    const base64Data = body.file || body.base64;

    if (!rawTo || !base64Data) {
      sendResponse(res, 400, { success: false, error: "Missing required parameters: 'to' and 'file' (base64)" });
      return;
    }

    const digits = String(rawTo).replace(/\D/g, "");
    const formattedPhone = digits.length === 10 ? `91${digits}` : digits;
    const jid = `${formattedPhone}@s.whatsapp.net`;

    try {
      const cleanBase64 = base64Data.replace(/^data:.*?;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");

      const result = await sock.sendMessage(jid, {
        document: buffer,
        mimetype: "application/pdf",
        fileName: filename,
        caption,
      });

      const msgId = result?.key?.id || `WA-FILE-${Date.now()}`;
      console.log(`📄 [OpenWA Gateway] Sent real WhatsApp document (${filename}) to ${formattedPhone} (ID: ${msgId})`);

      sendResponse(res, 200, {
        success: true,
        id: msgId,
        messageId: msgId,
        to: formattedPhone,
        filename,
        status: "SENT",
      });
    } catch (err) {
      console.error("❌ Send file error:", err);
      sendResponse(res, 500, { success: false, error: err?.message || "Failed to dispatch WhatsApp PDF document" });
    }
    return;
  }

  sendResponse(res, 404, { error: "Endpoint not found on OpenWA Gateway" });
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 OpenWA REST API Gateway for AURCLEAN ERP`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🔑 API Key: ${API_KEY}`);
  console.log(`📱 Session ID: ${SESSION_NAME}`);
  console.log(`==================================================\n`);

  // Auto-start WhatsApp WebSocket listener
  startWhatsAppSocket();
});
