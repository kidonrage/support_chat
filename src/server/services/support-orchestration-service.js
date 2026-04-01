import { createHttpError } from "../utils/http.js";
import { nowIso, truncate } from "../utils/text.js";

const SUPPORT_SYSTEM_PROMPT = [
  "You are a support assistant.",
  "Answer clearly, briefly, and only from the provided context.",
  "Use the ticket summary, recent messages, user context, and knowledge-base excerpts.",
  "Do not invent internal data, policies, or technical facts that are not in context.",
  "Do not invent UI paths, URLs, wait times, or account actions that are not explicitly present in context.",
  "If the diagnosis is uncertain, say that explicitly and use careful probabilistic wording.",
  "Start with the most likely explanation or current known state.",
  "Then give concrete resolution steps.",
  "If self-service is not enough, say when to contact a human operator.",
  "Always reply in the same language as the latest user message.",
].join(" ");

function detectPreferredLanguage(text) {
  if (/[А-Яа-яЁё]/.test(text)) {
    return "Russian";
  }

  return "English";
}

export class SupportOrchestrationService {
  constructor({
    ticketsRepository,
    messagesRepository,
    knowledgeBaseService,
    userContextService,
    summarizationService,
    ollamaClient,
    config,
  }) {
    this.ticketsRepository = ticketsRepository;
    this.messagesRepository = messagesRepository;
    this.knowledgeBaseService = knowledgeBaseService;
    this.userContextService = userContextService;
    this.summarizationService = summarizationService;
    this.ollamaClient = ollamaClient;
    this.config = config;
  }

  async listTickets(userId) {
    return this.ticketsRepository.listByUserId(userId);
  }

  async getMessages(ticketId) {
    const ticket = await this.ticketsRepository.getById(ticketId);

    if (!ticket) {
      throw createHttpError(404, "Ticket not found.");
    }

    return this.messagesRepository.listByTicketId(ticketId);
  }

  async createTicket(userId) {
    return this.ticketsRepository.create({ userId });
  }

  async closeTicket(ticketId) {
    const ticket = await this.ticketsRepository.getById(ticketId);

    if (!ticket) {
      throw createHttpError(404, "Ticket not found.");
    }

    return this.ticketsRepository.update(ticketId, {
      status: "closed",
      updatedAt: nowIso(),
    });
  }

  async handleChat({ userId, ticketId, message }) {
    const safeMessage = String(message || "").trim();

    if (!userId) {
      throw createHttpError(400, "userId is required.");
    }

    if (!safeMessage) {
      throw createHttpError(400, "message is required.");
    }

    let ticket = ticketId ? await this.ticketsRepository.getById(ticketId) : null;

    if (ticketId && !ticket) {
      throw createHttpError(404, "Ticket not found.");
    }

    if (ticket && ticket.userId !== userId) {
      throw createHttpError(404, "Ticket not found.");
    }

    if (!ticket) {
      ticket = await this.ticketsRepository.create({ userId });
    }

    if (ticket.status === "closed") {
      throw createHttpError(409, "This ticket is closed. Create a new ticket for a new request.");
    }

    await this.messagesRepository.create({
      ticketId: ticket.id,
      role: "user",
      text: safeMessage,
    });

    await this.ticketsRepository.update(ticket.id, {
      lastMessagePreview: truncate(safeMessage, 160),
      updatedAt: nowIso(),
    });

    const messages = await this.messagesRepository.listByTicketId(ticket.id);
    const summaryPayload = await this.summarizationService.updateTicketSummary({
      ticket,
      messages,
    });
    const retrievalQuery = [summaryPayload.summary, safeMessage].filter(Boolean).join("\n\n");

    const [ragChunks, userContext] = await Promise.all([
      this.knowledgeBaseService.retrieve(retrievalQuery, this.config.ragTopK).catch(() => []),
      this.userContextService.buildContext(userId).catch(() => ({
        found: false,
        user: null,
        accountContext: null,
        recentSignals: [],
      })),
    ]);

    const prompt = this.buildAnswerPrompt({
      ticket,
      summaryPayload,
      messages,
      latestUserMessage: safeMessage,
      ragChunks,
      userContext,
    });

    const answer = await this.ollamaClient.generate({
      model: this.config.chatModel,
      system: SUPPORT_SYSTEM_PROMPT,
      prompt,
      temperature: 0.2,
      timeoutMs: 90000,
    });

    await this.messagesRepository.create({
      ticketId: ticket.id,
      role: "assistant",
      text: answer,
    });

    const updatedTicket = await this.ticketsRepository.update(ticket.id, {
      title: summaryPayload.title || ticket.title,
      summary: summaryPayload.summary,
      category: summaryPayload.category || ticket.category || null,
      lastMessagePreview: truncate(answer || safeMessage, 160),
      updatedAt: nowIso(),
    });

    return {
      ticketId: updatedTicket.id,
      answer,
      ticket: updatedTicket,
    };
  }

  buildAnswerPrompt({ ticket, summaryPayload, messages, latestUserMessage, ragChunks, userContext }) {
    const preferredLanguage = detectPreferredLanguage(latestUserMessage);
    const recentMessages = messages.slice(-this.config.recentMessagesLimit).map((message) => ({
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
    }));

    const ticketMetadata = {
      ticketId: ticket.id,
      userId: ticket.userId,
      status: ticket.status,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      currentCategory: summaryPayload.category || ticket.category || null,
      messageCount: messages.length,
    };

    const formattedKnowledge = ragChunks.length
      ? ragChunks
          .map(
            (chunk, index) =>
              `[Doc ${index + 1}] ${chunk.title} (${chunk.source}, score=${chunk.score})\n${chunk.text}`
          )
          .join("\n\n")
      : "No matching knowledge-base excerpts were retrieved.";

    return [
      "Support context follows. Use it as the only source of truth.",
      `Required response language: ${preferredLanguage}.`,
      "",
      "Ticket summary:",
      summaryPayload.summary || "(empty)",
      "",
      "Latest user message:",
      latestUserMessage,
      "",
      "Ticket metadata:",
      JSON.stringify(ticketMetadata, null, 2),
      "",
      "Recent messages:",
      JSON.stringify(recentMessages, null, 2),
      "",
      "User context from MCP-like integration layer:",
      JSON.stringify(
        userContext.found
          ? {
              account: userContext.accountContext,
              recentSignals: userContext.recentSignals,
            }
          : {
              found: false,
              note: "User context not found in local CRM JSON source. Do not assume account details.",
            },
        null,
        2
      ),
      "",
      "Knowledge-base excerpts:",
      formattedKnowledge,
      "",
      "Answer format:",
      "- First paragraph: likely cause or what is known now",
      "- Then short step-by-step actions",
      "- Mention uncertainty when needed",
      "- Escalate to a human operator only when appropriate",
    ].join("\n");
  }
}
