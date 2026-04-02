import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { JsonFileStore } from "../utils/json-file-store.js";
import { TicketsRepository } from "../repositories/tickets-repository.js";
import { MessagesRepository } from "../repositories/messages-repository.js";
import { TicketToolService } from "../services/ticket-tool-service.js";
import { SupportOrchestrationService } from "../services/support-orchestration-service.js";
import { TicketsMcpClient } from "../mcp/tickets-mcp-client.js";

async function createTestEnvironment({ ollamaResponse, ticketsMcpClient = null }) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "support-chat-test-"));
  const runtimeDir = path.join(tempRoot, "runtime");
  await fs.mkdir(runtimeDir, { recursive: true });

  const ticketsStore = new JsonFileStore(path.join(runtimeDir, "tickets.json"), { tickets: [] });
  const messagesStore = new JsonFileStore(path.join(runtimeDir, "messages.json"), { messages: [] });

  await Promise.all([ticketsStore.ensure(), messagesStore.ensure()]);

  const ticketsRepository = new TicketsRepository(ticketsStore);
  const messagesRepository = new MessagesRepository(messagesStore);
  const ticketToolService = new TicketToolService({
    ticketsRepository,
  });

  const mcpClient =
    ticketsMcpClient ||
    new TicketsMcpClient({
      cwd: tempRoot,
      args: [path.join(process.cwd(), "src/server/mcp/tickets-mcp-server.js")],
      startupTimeoutMs: 3000,
      requestTimeoutMs: 3000,
    });

  const supportService = new SupportOrchestrationService({
    ticketsRepository,
    messagesRepository,
    knowledgeBaseService: {
      async retrieve() {
        return [];
      },
    },
    userContextService: {
      async buildContext() {
        return {
          found: false,
          user: null,
          accountContext: null,
          recentSignals: [],
        };
      },
    },
    summarizationService: {
      async updateTicketSummary() {
        return {
          summary: "User reports a support issue.",
          title: "Support issue",
          category: "technical",
        };
      },
    },
    ollamaClient: {
      async generate() {
        return ollamaResponse;
      },
    },
    ticketToolService,
    ticketsMcpClient: mcpClient,
    config: {
      chatModel: "qwen3:8b",
      ragTopK: 4,
      recentMessagesLimit: 8,
    },
  });

  return {
    tempRoot,
    ticketsStore,
    messagesStore,
    ticketsRepository,
    messagesRepository,
    supportService,
    ticketToolService,
    mcpClient,
    async cleanup() {
      await mcpClient.close().catch(() => {});
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

test("explicit confirmation triggers close_ticket through MCP and closes the ticket", async () => {
  const env = await createTestEnvironment({
    ollamaResponse: JSON.stringify({
      action: "tool_call",
      tool: "close_ticket",
      arguments: {
        ticketId: "forged_ticket_id",
        reason: "User confirmed issue resolved",
      },
      message_after_tool: "Glad to hear that the issue is resolved. I have closed this ticket.",
    }),
  });

  try {
    const result = await env.supportService.handleChat({
      userId: "u_001",
      ticketId: null,
      message: "Thanks, it works now.",
    });

    assert.equal(result.ticket.status, "closed");
    assert.equal(result.ticket.closeReason, "User confirmed issue resolved");
    assert.equal(result.answer, "Glad to hear that the issue is resolved. I have closed this ticket.");

    const storedTicket = await env.ticketsRepository.getById(result.ticketId);
    assert.equal(storedTicket.status, "closed");
    assert.equal(storedTicket.closeReason, "User confirmed issue resolved");
  } finally {
    await env.cleanup();
  }
});

test("follow-up question returns assistant text and keeps the ticket open", async () => {
  const env = await createTestEnvironment({
    ollamaResponse: JSON.stringify({
      action: "respond",
      message: "Please try signing out and back in, then tell me whether the error persists.",
    }),
  });

  try {
    const result = await env.supportService.handleChat({
      userId: "u_001",
      ticketId: null,
      message: "What should I try next?",
    });

    assert.equal(result.ticket.status, "open");
    assert.match(result.answer, /signing out and back in/i);
  } finally {
    await env.cleanup();
  }
});

test("already closed ticket returns graceful MCP result", async () => {
  const env = await createTestEnvironment({
    ollamaResponse: JSON.stringify({
      action: "respond",
      message: "unused",
    }),
  });

  try {
    const ticket = await env.ticketsRepository.create({ userId: "u_001" });
    await env.ticketToolService.closeTicket(ticket.id, "Resolved");
    const result = await env.mcpClient.callTool("close_ticket", {
      ticketId: ticket.id,
      reason: "Resolved again",
    });

    assert.equal(result.ok, true);
    assert.equal(result.code, "ALREADY_CLOSED");
    assert.equal(result.status, "closed");
    assert.equal(result.closed, false);
  } finally {
    await env.cleanup();
  }
});

test("invalid model tool call falls back without crashing", async () => {
  const env = await createTestEnvironment({
    ollamaResponse: JSON.stringify({
      action: "tool_call",
      tool: "delete_everything",
      arguments: {
        ticketId: "t_bad",
      },
      message_after_tool: "I closed it.",
    }),
  });

  try {
    const result = await env.supportService.handleChat({
      userId: "u_001",
      ticketId: null,
      message: "Can you help me with this?",
    });

    assert.equal(result.ticket.status, "open");
    assert.match(result.answer, /keep helping/i);
  } finally {
    await env.cleanup();
  }
});

test("MCP unavailable leaves ticket open and returns a safe fallback message", async () => {
  const env = await createTestEnvironment({
    ollamaResponse: JSON.stringify({
      action: "tool_call",
      tool: "close_ticket",
      arguments: {
        ticketId: "t_any",
        reason: "User confirmed issue resolved",
      },
      message_after_tool: "Done, ticket closed.",
    }),
    ticketsMcpClient: {
      async callTool() {
        throw new Error("MCP server is unavailable.");
      },
      async close() {},
    },
  });

  try {
    const result = await env.supportService.handleChat({
      userId: "u_001",
      ticketId: null,
      message: "Спасибо, теперь работает.",
    });

    assert.equal(result.ticket.status, "open");
    assert.match(result.answer, /не смог закрыть тикет/i);
  } finally {
    await env.cleanup();
  }
});
