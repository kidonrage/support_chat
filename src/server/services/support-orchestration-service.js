import { createHttpError } from "../utils/http.js";
import { normalizeWhitespace, nowIso, truncate } from "../utils/text.js";
import { buildSupportActionPrompt, SUPPORT_ACTION_SYSTEM_PROMPT } from "../prompts/support-action-prompt.js";
import { parseSupportActionDecision } from "./support-action-decision.js";

function createSourceLinkPath(sourcePath) {
  const normalizedPath = String(sourcePath || "").replace(/^\/+/, "");
  const fullPath = normalizedPath.startsWith("knowledge_base/") ? normalizedPath : `knowledge_base/${normalizedPath}`;
  return `/${fullPath.split("/").map(encodeURIComponent).join("/")}`;
}

export class SupportOrchestrationService {
  constructor({
    ticketsRepository,
    messagesRepository,
    knowledgeBaseService,
    userContextService,
    summarizationService,
    ollamaClient,
    ticketToolService,
    ticketsMcpClient,
    config,
  }) {
    this.ticketsRepository = ticketsRepository;
    this.messagesRepository = messagesRepository;
    this.knowledgeBaseService = knowledgeBaseService;
    this.userContextService = userContextService;
    this.summarizationService = summarizationService;
    this.ollamaClient = ollamaClient;
    this.ticketToolService = ticketToolService;
    this.ticketsMcpClient = ticketsMcpClient;
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

  async closeTicket(ticketId, reason = null) {
    const result = await this.ticketToolService.closeTicket(ticketId, reason);

    if (result.code === "TICKET_NOT_FOUND") {
      throw createHttpError(404, "Ticket not found.");
    }

    return result.ticket;
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

    const prompt = buildSupportActionPrompt({
      ticket,
      summaryPayload,
      messages,
      latestUserMessage: safeMessage,
      ragChunks,
      userContext,
      recentMessagesLimit: this.config.recentMessagesLimit,
    });

    const rawDecision = await this.ollamaClient.generate({
      model: this.config.chatModel,
      system: SUPPORT_ACTION_SYSTEM_PROMPT,
      prompt,
      format: "json",
      temperature: 0.2,
      timeoutMs: 90000,
    });

    const decision = parseSupportActionDecision(rawDecision);
    const outcome = await this.resolveAssistantOutcome({
      ticket,
      latestUserMessage: safeMessage,
      decision,
      ragChunks,
    });
    const answerSources = outcome.includeSources ? this.buildAnswerSources(ragChunks) : [];
    const assistantMessage = await this.messagesRepository.create({
      ticketId: ticket.id,
      role: "assistant",
      text: outcome.answer,
      sources: answerSources,
    });

    const updatedTicket = await this.ticketsRepository.update(outcome.ticket.id, {
      title: summaryPayload.title || ticket.title,
      summary: summaryPayload.summary,
      category: summaryPayload.category || outcome.ticket.category || ticket.category || null,
      lastMessagePreview: truncate(outcome.answer || safeMessage, 160),
      updatedAt: nowIso(),
    });

    return {
      ticketId: updatedTicket.id,
      answer: outcome.answer,
      sources: answerSources,
      assistantMessage,
      ticket: updatedTicket,
    };
  }

  async resolveAssistantOutcome({ ticket, latestUserMessage, decision, ragChunks }) {
    if (decision.type !== "tool_call") {
      return {
        answer: decision.message,
        ticket,
        includeSources: true,
      };
    }

    const requestedTicketId = decision.arguments.ticketId;
    const forcedArguments = {
      ticketId: ticket.id,
      reason: decision.arguments.reason || this.buildFallbackCloseReason(latestUserMessage),
    };

    console.info("[chat][tool_request]", {
      tool: decision.tool,
      requestedTicketId,
      forcedTicketId: forcedArguments.ticketId,
      arguments: forcedArguments,
    });

    let toolResult;

    try {
      toolResult = await this.ticketsMcpClient.callTool(decision.tool, forcedArguments);
    } catch (error) {
      console.warn("[chat][tool_failure]", {
        tool: decision.tool,
        ticketId: ticket.id,
        message: error.message,
      });

      return {
        answer: this.buildToolFailureMessage(latestUserMessage),
        ticket,
        includeSources: false,
      };
    }

    console.info("[chat][tool_result]", {
      tool: decision.tool,
      arguments: forcedArguments,
      ok: toolResult?.ok ?? false,
      code: toolResult?.code || null,
      status: toolResult?.status || null,
    });

    if (!toolResult?.ok) {
      return {
        answer: this.buildToolFailureMessage(latestUserMessage),
        ticket,
        includeSources: false,
      };
    }

    const updatedTicket = toolResult.ticket || (await this.ticketsRepository.getById(ticket.id)) || ticket;
    const answer =
      toolResult.code === "ALREADY_CLOSED"
        ? this.buildAlreadyClosedMessage(latestUserMessage)
        : decision.messageAfterTool;

    console.info("[chat][ticket_status]", {
      ticketId: updatedTicket.id,
      status: updatedTicket.status,
    });

    return {
      answer,
      ticket: updatedTicket,
      includeSources: false,
    };
  }

  buildAnswerSources(ragChunks) {
    return ragChunks.map((chunk) => ({
      id: chunk.id,
      title: chunk.title,
      source: chunk.source,
      score: chunk.score,
      excerpt: truncate(chunk.text, 220),
      url: createSourceLinkPath(chunk.source),
    }));
  }

  buildFallbackCloseReason(latestUserMessage) {
    const cleanMessage = normalizeWhitespace(latestUserMessage || "");
    return truncate(cleanMessage || "User confirmed issue resolved.", 240);
  }

  buildToolFailureMessage(latestUserMessage) {
    if (/[А-Яа-яЁё]/.test(latestUserMessage)) {
      return "Похоже, вопрос решён, но я не смог закрыть тикет автоматически. Он пока останется открытым.";
    }

    return "It looks resolved, but I could not close the ticket automatically, so it remains open for now.";
  }

  buildAlreadyClosedMessage(latestUserMessage) {
    if (/[А-Яа-яЁё]/.test(latestUserMessage)) {
      return "Этот тикет уже закрыт.";
    }

    return "This ticket is already closed.";
  }
}
