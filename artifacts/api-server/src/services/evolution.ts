/**
 * Evolution API v2 HTTP client.
 *
 * Required env vars:
 *   EVOLUTION_API_URL   — base URL, e.g. https://evolution.example.com
 *   EVOLUTION_API_KEY   — global API key
 */

const BASE_URL = (process.env["EVOLUTION_API_URL"] ?? "").replace(/\/$/, "");
const API_KEY = process.env["EVOLUTION_API_KEY"] ?? "";

function getHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: API_KEY,
  };
}

async function evoFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!BASE_URL) {
    throw new Error(
      "EVOLUTION_API_URL is not configured. Set it to your Evolution API base URL.",
    );
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Evolution API error ${res.status} on ${path}: ${body}`,
    );
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Instance management
// ---------------------------------------------------------------------------

export interface EvolutionInstanceInfo {
  instance: {
    instanceName: string;
    status: string;
    owner?: string;
  };
  hash?: { apikey: string };
}

export async function createInstance(
  instanceName: string,
  webhookUrl: string,
  webhookSecret: string,
): Promise<EvolutionInstanceInfo> {
  return evoFetch<EvolutionInstanceInfo>("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      webhook: {
        url: webhookUrl,
        byEvents: true,
        base64: false,
        headers: { "x-webhook-secret": webhookSecret },
        events: [
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "CONNECTION_UPDATE",
          "QRCODE_UPDATED",
        ],
      },
    }),
  });
}

export async function deleteInstance(instanceName: string): Promise<void> {
  await evoFetch(`/instance/delete/${instanceName}`, { method: "DELETE" });
}

export interface QrCodeResponse {
  code?: string;
  base64?: string;
}

export async function getQrCode(
  instanceName: string,
): Promise<QrCodeResponse> {
  return evoFetch<QrCodeResponse>(`/instance/connect/${instanceName}`);
}

export interface ConnectionState {
  instance: {
    instanceName: string;
    state: "open" | "connecting" | "close";
  };
}

export async function getConnectionState(
  instanceName: string,
): Promise<ConnectionState> {
  return evoFetch<ConnectionState>(
    `/instance/connectionState/${instanceName}`,
  );
}

export async function logoutInstance(instanceName: string): Promise<void> {
  await evoFetch(`/instance/logout/${instanceName}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface SendTextResult {
  key: { id: string };
  status: string;
}

export async function sendText(
  instanceName: string,
  to: string,
  text: string,
): Promise<SendTextResult> {
  return evoFetch<SendTextResult>(`/message/sendText/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: to,
      text,
    }),
  });
}

export interface SendMediaResult {
  key: { id: string };
  status: string;
}

export async function sendMedia(
  instanceName: string,
  to: string,
  mediatype: "image" | "video" | "document" | "audio",
  mediaUrl: string,
  caption?: string,
  fileName?: string,
): Promise<SendMediaResult> {
  return evoFetch<SendMediaResult>(`/message/sendMedia/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: to,
      mediatype,
      media: mediaUrl,
      caption,
      fileName,
    }),
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Normalise a WhatsApp JID to just the phone number (5511999999999). */
export function jidToPhone(jid: string): string {
  return jid.replace(/@.*$/, "").replace(/:.*$/, "");
}

/** Convert a phone number to a WhatsApp JID. */
export function phoneToJid(phone: string): string {
  return `${phone}@s.whatsapp.net`;
}

export function isEvolutionConfigured(): boolean {
  return Boolean(BASE_URL && API_KEY);
}
