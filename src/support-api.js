const DEFAULT_HEADERS = {
  Accept: "application/json",
};

/**
 * @typedef {"open" | "closed"} TicketStatus
 */

/**
 * @typedef {{
 *   id: string | null,
 *   title: string,
 *   status: TicketStatus,
 *   updatedAt: string | null,
 *   lastMessagePreview: string,
 *   isDraft: boolean
 * }} Ticket
 */

/**
 * @typedef {{
 *   id: string,
 *   role: "user" | "assistant" | "system",
 *   text: string,
 *   createdAt: string | null,
 *   pending?: boolean,
 *   loading?: boolean
 * }} SupportMessage
 */

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  return safeJsonParse(text) ?? text;
}

function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function normalizeStatus(status) {
  return status === "closed" ? "closed" : "open";
}

function normalizeTicket(rawTicket) {
  if (!rawTicket) {
    return null;
  }

  const id = pickFirstDefined(rawTicket.id, rawTicket.ticketId, rawTicket.ticket_id, null);
  const lastMessage =
    pickFirstDefined(
      rawTicket.lastMessagePreview,
      rawTicket.preview,
      rawTicket.lastMessage?.text,
      rawTicket.lastMessage?.message,
      ""
    ) || "";

  return {
    id,
    title: pickFirstDefined(rawTicket.title, rawTicket.subject, "New ticket") || "New ticket",
    status: normalizeStatus(rawTicket.status),
    updatedAt: pickFirstDefined(
      rawTicket.updatedAt,
      rawTicket.updated_at,
      rawTicket.lastMessageAt,
      rawTicket.createdAt,
      null
    ),
    lastMessagePreview: String(lastMessage).trim(),
    isDraft: false,
  };
}

function normalizeRole(rawMessage) {
  const role = pickFirstDefined(rawMessage.role, rawMessage.sender, rawMessage.author, "assistant");

  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }

  if (role === "client" || role === "customer") {
    return "user";
  }

  return "assistant";
}

function normalizeMessage(rawMessage, index) {
  return {
    id:
      pickFirstDefined(rawMessage.id, rawMessage.messageId, rawMessage.createdAt, rawMessage.timestamp) ||
      `message-${index}`,
    role: normalizeRole(rawMessage),
    text: String(pickFirstDefined(rawMessage.text, rawMessage.message, rawMessage.content, "")),
    createdAt: pickFirstDefined(rawMessage.createdAt, rawMessage.timestamp, rawMessage.sentAt, null),
  };
}

export class SupportApi {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request(path, options = {}) {
    const { body, headers = {}, ...restOptions } = options;
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...restOptions,
      headers: {
        ...DEFAULT_HEADERS,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const payload = await parseResponseBody(response);

    if (!response.ok) {
      const errorMessage =
        payload?.error?.message ||
        payload?.message ||
        (typeof payload === "string" && payload) ||
        `${response.status} ${response.statusText}`;

      throw new Error(errorMessage);
    }

    return payload;
  }

  async getTickets(userId) {
    const payload = await this.request(`/api/tickets?userId=${encodeURIComponent(userId)}`);
    const tickets = Array.isArray(payload) ? payload : payload?.tickets || payload?.items || [];

    return tickets
      .map((ticket) => normalizeTicket(ticket))
      .filter(Boolean);
  }

  async getMessages(ticketId, signal) {
    const payload = await this.request(`/api/tickets/${encodeURIComponent(ticketId)}/messages`, {
      signal,
    });
    const messages = Array.isArray(payload) ? payload : payload?.messages || payload?.items || [];

    return messages.map((message, index) => normalizeMessage(message, index));
  }

  async sendMessage({ userId, ticketId, message }) {
    const payload = await this.request("/api/chat", {
      method: "POST",
      body: {
        userId,
        ticketId,
        message,
      },
    });

    const ticket = normalizeTicket(payload?.ticket || payload);
    const resolvedTicketId = pickFirstDefined(payload?.ticketId, ticket?.id, null);

    return {
      ticketId: resolvedTicketId,
      answer: String(pickFirstDefined(payload?.answer, payload?.message, "")),
      ticket: ticket
        ? {
            ...ticket,
            id: resolvedTicketId,
          }
        : null,
    };
  }

  async createTicket(userId) {
    const payload = await this.request("/api/tickets", {
      method: "POST",
      body: {
        userId,
      },
    });

    if (!payload) {
      return null;
    }

    return normalizeTicket(payload?.ticket || payload);
  }

  async closeTicket(ticketId) {
    const payload = await this.request(`/api/tickets/${encodeURIComponent(ticketId)}/close`, {
      method: "POST",
    });

    const normalized = normalizeTicket(payload?.ticket || payload);

    return normalized
      ? {
          ...normalized,
          status: "closed",
        }
      : null;
  }
}

export function createDraftTicket() {
  return {
    id: null,
    title: "New ticket",
    status: "open",
    updatedAt: null,
    lastMessagePreview: "",
    isDraft: true,
  };
}
