import { extractJsonObject, normalizeWhitespace, truncate } from "../utils/text.js";

const SAFE_INVALID_TOOL_MESSAGE =
  "I can keep helping with this ticket. If the issue is already resolved, tell me clearly and I will close it.";

function sanitizeMessage(value, fallback) {
  const normalized = normalizeWhitespace(value || "");
  return normalized ? truncate(normalized, 3000) : fallback;
}

function sanitizeReason(value) {
  const normalized = normalizeWhitespace(value || "");
  return normalized ? truncate(normalized, 240) : null;
}

export function parseSupportActionDecision(rawText) {
  const raw = String(rawText || "").trim();
  const parsed = extractJsonObject(raw);

  if (!parsed || typeof parsed !== "object") {
    return {
      type: "respond",
      message: sanitizeMessage(raw, SAFE_INVALID_TOOL_MESSAGE),
      raw,
      parseError: !raw,
    };
  }

  if (parsed.action === "respond") {
    return {
      type: "respond",
      message: sanitizeMessage(parsed.message, SAFE_INVALID_TOOL_MESSAGE),
      raw,
    };
  }

  if (parsed.action === "tool_call") {
    const tool = String(parsed.tool || "").trim();
    const argumentsObject =
      parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)
        ? parsed.arguments
        : null;
    const ticketId = String(argumentsObject?.ticketId || "").trim();

    if (tool !== "close_ticket" || !ticketId) {
      return {
        type: "respond",
        message: SAFE_INVALID_TOOL_MESSAGE,
        raw,
        invalidToolCall: true,
      };
    }

    return {
      type: "tool_call",
      tool: "close_ticket",
      arguments: {
        ticketId,
        reason: sanitizeReason(argumentsObject.reason),
      },
      messageAfterTool: sanitizeMessage(parsed.message_after_tool, "The ticket has been closed."),
      raw,
    };
  }

  return {
    type: "respond",
    message: sanitizeMessage(parsed.message || raw, SAFE_INVALID_TOOL_MESSAGE),
    raw,
    invalidAction: true,
  };
}
