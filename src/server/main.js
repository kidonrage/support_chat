import http from "node:http";
import fs from "node:fs/promises";

import { config } from "./config.js";
import { JsonFileStore } from "./utils/json-file-store.js";
import { createHttpError, readJsonBody, sendError, sendJson, serveStaticFile } from "./utils/http.js";
import { TicketsRepository } from "./repositories/tickets-repository.js";
import { MessagesRepository } from "./repositories/messages-repository.js";
import { OllamaClient } from "./services/ollama-client.js";
import { EmbeddingsService } from "./services/embeddings-service.js";
import { KnowledgeBaseService } from "./services/knowledge-base-service.js";
import { UserContextService } from "./services/user-context-service.js";
import { SummarizationService } from "./services/summarization-service.js";
import { SupportOrchestrationService } from "./services/support-orchestration-service.js";
import { TicketToolService } from "./services/ticket-tool-service.js";
import { TicketsMcpClient } from "./mcp/tickets-mcp-client.js";

const ticketsStore = new JsonFileStore(config.ticketsFilePath, { tickets: [] });
const messagesStore = new JsonFileStore(config.messagesFilePath, { messages: [] });
const knowledgeIndexStore = new JsonFileStore(config.knowledgeIndexFilePath, {
  builtAt: null,
  embeddingModel: config.embeddingModel,
  signature: null,
  documents: [],
  chunks: [],
});

const ticketsRepository = new TicketsRepository(ticketsStore);
const messagesRepository = new MessagesRepository(messagesStore);
const ollamaClient = new OllamaClient({
  baseUrl: config.ollamaBaseUrl,
  chatModel: config.chatModel,
  summaryModel: config.summaryModel,
  embeddingModel: config.embeddingModel,
});
const embeddingsService = new EmbeddingsService(ollamaClient);
const knowledgeBaseService = new KnowledgeBaseService({
  knowledgeBaseDir: config.knowledgeBaseDir,
  indexStore: knowledgeIndexStore,
  embeddingsService,
  embeddingModel: config.embeddingModel,
});
const userContextService = new UserContextService({
  usersFilePath: config.usersFilePath,
});
const summarizationService = new SummarizationService({
  ollamaClient,
  model: config.summaryModel,
});
const ticketToolService = new TicketToolService({
  ticketsRepository,
});
const ticketsMcpClient = TicketsMcpClient.createDefault({
  projectRoot: config.projectRoot,
  startupTimeoutMs: config.mcpStartupTimeoutMs,
  requestTimeoutMs: config.mcpRequestTimeoutMs,
});
const supportService = new SupportOrchestrationService({
  ticketsRepository,
  messagesRepository,
  knowledgeBaseService,
  userContextService,
  summarizationService,
  ollamaClient,
  ticketToolService,
  ticketsMcpClient,
  config,
});

async function ensureRuntimeFiles() {
  await fs.mkdir(config.runtimeDir, { recursive: true });
  await Promise.all([ticketsStore.ensure(), messagesStore.ensure(), knowledgeIndexStore.ensure()]);
}

function routeRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${config.host}:${config.port}`}`);

  return handleRequest(request, response, url).catch((error) => {
    if (error.statusCode && error.statusCode < 500) {
      sendError(response, error);
      return;
    }

    console.error(error);
    sendError(response, error.statusCode ? error : createHttpError(500, "Internal server error."));
  });
}

async function handleRequest(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      models: {
        chat: config.chatModel,
        summary: config.summaryModel,
        embeddings: config.embeddingModel,
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tickets") {
    const userId = url.searchParams.get("userId") || "";

    if (!userId) {
      throw createHttpError(400, "userId query parameter is required.");
    }

    const tickets = await supportService.listTickets(userId);
    sendJson(response, 200, { tickets });
    return;
  }

  if (request.method === "GET" && /^\/api\/tickets\/[^/]+\/messages$/.test(url.pathname)) {
    const ticketId = decodeURIComponent(url.pathname.split("/")[3]);
    const messages = await supportService.getMessages(ticketId);
    sendJson(response, 200, { messages });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/tickets") {
    const body = await readJsonBody(request, config.requestBodyLimitBytes);
    const userId = String(body.userId || "").trim();

    if (!userId) {
      throw createHttpError(400, "userId is required.");
    }

    const ticket = await supportService.createTicket(userId);
    sendJson(response, 201, { ticket });
    return;
  }

  if (request.method === "POST" && /^\/api\/tickets\/[^/]+\/close$/.test(url.pathname)) {
    const ticketId = decodeURIComponent(url.pathname.split("/")[3]);
    const body = await readJsonBody(request, config.requestBodyLimitBytes).catch((error) => {
      if (error.statusCode === 415) {
        return {};
      }

      throw error;
    });
    const ticket = await supportService.closeTicket(ticketId, body.reason ? String(body.reason) : null);
    sendJson(response, 200, { ticket });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJsonBody(request, config.requestBodyLimitBytes);
    const result = await supportService.handleChat({
      userId: String(body.userId || "").trim(),
      ticketId: body.ticketId ? String(body.ticketId).trim() : null,
      message: String(body.message || ""),
    });
    sendJson(response, 200, result);
    return;
  }

  if (request.method !== "GET" && !url.pathname.startsWith("/api/")) {
    throw createHttpError(405, "Method not allowed.");
  }

  await serveStaticFile(response, config.projectRoot, url.pathname);
}

async function bootstrap() {
  await ensureRuntimeFiles();

  knowledgeBaseService.ensureIndex().catch((error) => {
    console.warn("Knowledge-base index warmup failed:", error.message);
  });

  const server = http.createServer(routeRequest);
  server.on("error", (error) => {
    console.error("Server listen failed:", error.message);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    console.log(`Support server listening on http://${config.host}:${config.port}`);
  });

  const shutdown = () => {
    void ticketsMcpClient.close().finally(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error("Server bootstrap failed:", error);
  process.exitCode = 1;
});
