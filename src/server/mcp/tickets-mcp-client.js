import path from "node:path";
import { spawn } from "node:child_process";

import { createHttpError } from "../utils/http.js";
import { MCP_PROTOCOL_VERSION, encodeMessage } from "./protocol.js";

export class TicketsMcpClient {
  constructor({ command = process.execPath, args = [], cwd, startupTimeoutMs = 5000, requestTimeoutMs = 5000 } = {}) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.startupTimeoutMs = startupTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.process = null;
    this.pending = new Map();
    this.nextId = 1;
    this.readBuffer = "";
    this.startPromise = null;
  }

  static createDefault({ projectRoot, startupTimeoutMs, requestTimeoutMs } = {}) {
    const cwd = projectRoot || process.cwd();

    return new TicketsMcpClient({
      cwd,
      startupTimeoutMs,
      requestTimeoutMs,
      args: [path.join(cwd, "src/server/mcp/tickets-mcp-server.js")],
    });
  }

  async listTools() {
    await this.ensureStarted();
    const result = await this.sendRequest("tools/list", {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name, argumentsObject) {
    await this.ensureStarted();
    const result = await this.sendRequest("tools/call", {
      name,
      arguments: argumentsObject && typeof argumentsObject === "object" ? argumentsObject : {},
    });

    return result?.structuredContent || null;
  }

  async ensureStarted() {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.start().catch((error) => {
      this.startPromise = null;
      throw error;
    });

    return this.startPromise;
  }

  async close() {
    if (!this.process) {
      return;
    }

    const runningProcess = this.process;
    this.process = null;

    for (const pending of this.pending.values()) {
      pending.reject(createHttpError(503, "MCP server stopped unexpectedly."));
      clearTimeout(pending.timeoutId);
    }

    this.pending.clear();
    runningProcess.stdin.end();
  }

  async start() {
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.process = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      this.onStdout(chunk);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk || "").trim();

      if (text) {
        console.info("[mcp][stderr]", text);
      }
    });

    child.on("error", (error) => {
      this.failAllPending(createHttpError(503, "MCP server failed to start.", { cause: error.message }));
    });

    child.on("exit", (code, signal) => {
      this.process = null;
      this.startPromise = null;
      this.failAllPending(
        createHttpError(503, "MCP server is unavailable.", {
          code,
          signal,
        })
      );
    });

    const initializeResult = await this.sendRequest(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "support-chat-backend",
          version: "1.0.0",
        },
      },
      this.startupTimeoutMs
    );

    this.sendNotification("notifications/initialized", {});

    if (!initializeResult || initializeResult.protocolVersion !== MCP_PROTOCOL_VERSION) {
      throw createHttpError(503, "MCP protocol negotiation failed.", {
        result: initializeResult,
      });
    }
  }

  sendNotification(method, params) {
    if (!this.process?.stdin.writable) {
      return;
    }

    this.process.stdin.write(
      encodeMessage({
        jsonrpc: "2.0",
        method,
        params,
      })
    );
  }

  sendRequest(method, params, timeoutOverrideMs) {
    if (!this.process?.stdin.writable) {
      return Promise.reject(createHttpError(503, "MCP server is unavailable."));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(createHttpError(504, "MCP request timed out.", { method }));
      }, timeoutOverrideMs || this.requestTimeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timeoutId,
      });

      this.process.stdin.write(
        encodeMessage({
          jsonrpc: "2.0",
          id,
          method,
          params,
        })
      );
    });
  }

  onStdout(chunk) {
    this.readBuffer += chunk;

    while (this.readBuffer.includes("\n")) {
      const separatorIndex = this.readBuffer.indexOf("\n");
      const line = this.readBuffer.slice(0, separatorIndex).trim();
      this.readBuffer = this.readBuffer.slice(separatorIndex + 1);

      if (!line) {
        continue;
      }

      let message = null;

      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      const pending = this.pending.get(message.id);

      if (!pending) {
        continue;
      }

      clearTimeout(pending.timeoutId);
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(
          createHttpError(503, `MCP request failed: ${message.error.message || "unknown error"}.`, {
            code: message.error.code,
            data: message.error.data || null,
          })
        );
        continue;
      }

      pending.resolve(message.result);
    }
  }

  failAllPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }

    this.pending.clear();
  }
}
