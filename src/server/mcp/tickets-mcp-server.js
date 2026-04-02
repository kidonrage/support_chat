import process from "node:process";

import { config } from "../config.js";
import { TicketsRepository } from "../repositories/tickets-repository.js";
import { JsonFileStore } from "../utils/json-file-store.js";
import { TicketToolService } from "../services/ticket-tool-service.js";
import { MCP_PROTOCOL_VERSION, createJsonRpcError, createJsonRpcSuccess, encodeMessage } from "./protocol.js";

const ticketsStore = new JsonFileStore(config.ticketsFilePath, { tickets: [] });
const ticketsRepository = new TicketsRepository(ticketsStore);
const ticketToolService = new TicketToolService({ ticketsRepository });

const serverInfo = {
  name: "support-ticket-mcp",
  version: "1.0.0",
};

const tools = [
  {
    name: "close_ticket",
    title: "Close Ticket",
    description: "Close an open support ticket in the shared local ticket storage.",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: {
          type: "string",
          description: "Ticket identifier.",
        },
        reason: {
          type: "string",
          description: "Optional short reason for closing the ticket.",
        },
      },
      required: ["ticketId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_ticket_status",
    title: "Get Ticket Status",
    description: "Read the current status of a support ticket from the shared local ticket storage.",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: {
          type: "string",
          description: "Ticket identifier.",
        },
      },
      required: ["ticketId"],
      additionalProperties: false,
    },
  },
];

let initialized = false;
let inputBuffer = "";

function logToStderr(message, details = null) {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  process.stderr.write(`[tickets-mcp] ${message}${payload}\n`);
}

function send(message) {
  process.stdout.write(encodeMessage(message));
}

function createToolResult(result) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result),
      },
    ],
    structuredContent: result,
    isError: result.ok === false,
  };
}

async function handleRequest(message) {
  if (message.method === "initialize") {
    initialized = true;

    return createJsonRpcSuccess(message.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo,
      instructions: "Support ticket MCP server with close_ticket and get_ticket_status tools.",
    });
  }

  if (!initialized) {
    return createJsonRpcError(message.id, -32002, "Server not initialized.");
  }

  if (message.method === "tools/list") {
    return createJsonRpcSuccess(message.id, { tools });
  }

  if (message.method === "tools/call") {
    const name = String(message.params?.name || "").trim();
    const args =
      message.params?.arguments && typeof message.params.arguments === "object"
        ? message.params.arguments
        : {};

    if (name === "close_ticket") {
      const result = await ticketToolService.closeTicket(args.ticketId, args.reason);
      return createJsonRpcSuccess(message.id, createToolResult(result));
    }

    if (name === "get_ticket_status") {
      const result = await ticketToolService.getTicketStatus(args.ticketId);
      return createJsonRpcSuccess(message.id, createToolResult(result));
    }

    return createJsonRpcError(message.id, -32601, `Unknown tool: ${name}`);
  }

  return createJsonRpcError(message.id, -32601, `Unknown method: ${message.method}`);
}

function handleNotification(message) {
  if (message.method === "notifications/initialized") {
    return;
  }

  logToStderr("Ignoring notification", { method: message.method });
}

async function handleMessage(rawLine) {
  let message;

  try {
    message = JSON.parse(rawLine);
  } catch {
    logToStderr("Ignoring malformed JSON line");
    return;
  }

  if (Array.isArray(message)) {
    send(createJsonRpcError(null, -32600, "Batch requests are not supported."));
    return;
  }

  if (!message || message.jsonrpc !== "2.0") {
    send(createJsonRpcError(message?.id ?? null, -32600, "Invalid JSON-RPC request."));
    return;
  }

  if (message.id === undefined || message.id === null) {
    handleNotification(message);
    return;
  }

  try {
    const response = await handleRequest(message);
    send(response);
  } catch (error) {
    logToStderr("Tool execution failed", {
      message: error.message,
    });
    send(createJsonRpcError(message.id, -32000, "Tool execution failed.", { cause: error.message }));
  }
}

process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;

  while (inputBuffer.includes("\n")) {
    const separatorIndex = inputBuffer.indexOf("\n");
    const line = inputBuffer.slice(0, separatorIndex).trim();
    inputBuffer = inputBuffer.slice(separatorIndex + 1);

    if (!line) {
      continue;
    }

    void handleMessage(line);
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.stdin.on("error", (error) => {
  logToStderr("stdin error", { message: error.message });
  process.exit(1);
});

process.stdout.on("error", () => {
  process.exit(0);
});

await ticketsStore.ensure();
logToStderr("Server started", { ticketsFilePath: config.ticketsFilePath });
