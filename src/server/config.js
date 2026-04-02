import path from "node:path";

const projectRoot = process.cwd();

export const config = {
  projectRoot,
  host: process.env.HOST || "127.0.0.1",
  port: Number.parseInt(process.env.PORT || "3000", 10),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  chatModel: process.env.OLLAMA_CHAT_MODEL || "qwen3:8b",
  summaryModel: process.env.OLLAMA_SUMMARY_MODEL || "qwen3:8b",
  embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || "embeddinggemma",
  runtimeDir: path.join(projectRoot, "runtime"),
  knowledgeBaseDir: path.join(projectRoot, "knowledge_base"),
  usersFilePath: path.join(projectRoot, "data", "users.json"),
  ticketsFilePath: path.join(projectRoot, "runtime", "tickets.json"),
  messagesFilePath: path.join(projectRoot, "runtime", "messages.json"),
  knowledgeIndexFilePath: path.join(projectRoot, "runtime", "knowledge-index.json"),
  requestBodyLimitBytes: 64 * 1024,
  recentMessagesLimit: 8,
  ragTopK: 4,
  mcpStartupTimeoutMs: Number.parseInt(process.env.MCP_STARTUP_TIMEOUT_MS || "5000", 10),
  mcpRequestTimeoutMs: Number.parseInt(process.env.MCP_REQUEST_TIMEOUT_MS || "5000", 10),
};
