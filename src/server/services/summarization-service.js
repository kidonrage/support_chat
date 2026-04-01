import { extractJsonObject, titleCaseFromText, truncate } from "../utils/text.js";

const ALLOWED_CATEGORIES = new Set(["login", "billing", "subscription", "technical", "general"]);

function inferCategory(text) {
  const normalized = String(text || "").toLowerCase();

  if (/(login|log in|sign in|password|auth|2fa|authorization)/.test(normalized)) {
    return "login";
  }

  if (/(payment|card|invoice|charged|refund|billing)/.test(normalized)) {
    return "billing";
  }

  if (/(subscription|plan|cancel|renew|downgrade|upgrade)/.test(normalized)) {
    return "subscription";
  }

  if (/(error|bug|crash|timeout|does not work|broken|issue)/.test(normalized)) {
    return "technical";
  }

  return "general";
}

export class SummarizationService {
  constructor({ ollamaClient, model }) {
    this.ollamaClient = ollamaClient;
    this.model = model;
  }

  async updateTicketSummary({ ticket, messages }) {
    const recentMessages = messages.slice(-12).map((message) => ({
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
    }));

    const prompt = [
      "Summarize the support ticket. Return strict JSON only.",
      'JSON schema: {"summary":"string","title":"string","category":"login|billing|subscription|technical|general|null"}',
      "Rules:",
      "- summary must be 1-3 sentences and reflect the current state of the ticket",
      "- title must be short, human readable, max 6 words",
      "- category must be null if unclear",
      "- do not invent facts not present in the conversation",
      "",
      `Existing ticket summary: ${ticket.summary || "(empty)"}`,
      "",
      "Recent messages:",
      JSON.stringify(recentMessages, null, 2),
    ].join("\n");

    try {
      const raw = await this.ollamaClient.generate({
        model: this.model,
        system: "You write compact support ticket summaries and output JSON only.",
        prompt,
        format: "json",
        temperature: 0.1,
        timeoutMs: 45000,
      });

      const parsed = extractJsonObject(raw);
      const summary = truncate(parsed?.summary || "", 1200);
      const title = truncate(parsed?.title || "", 80);
      const category = ALLOWED_CATEGORIES.has(parsed?.category) ? parsed.category : null;

      if (summary) {
        return {
          summary,
          title: title || this.buildFallbackTitle(messages, summary),
          category: category || inferCategory(summary),
        };
      }
    } catch {
      // Fallback below keeps the ticket pipeline alive even if structured summary fails.
    }

    const fallbackSummary = this.buildFallbackSummary(messages);

    return {
      summary: fallbackSummary,
      title: this.buildFallbackTitle(messages, fallbackSummary),
      category: inferCategory(fallbackSummary),
    };
  }

  buildFallbackSummary(messages) {
    const lastMessages = messages.slice(-4);
    const combined = lastMessages
      .map((message) => `${message.role}: ${message.text}`)
      .join(" ")
      .trim();

    return truncate(combined || "Support conversation is in progress.", 500);
  }

  buildFallbackTitle(messages, summary) {
    const firstUserMessage = messages.find((message) => message.role === "user")?.text || summary || "New ticket";
    return truncate(titleCaseFromText(firstUserMessage), 80);
  }
}
