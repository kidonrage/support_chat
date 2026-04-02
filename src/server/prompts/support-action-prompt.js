const SUPPORT_ACTION_SYSTEM_PROMPT = [
  "You are a support assistant in a ticket-based support system.",
  "You have one tool: close_ticket(ticketId, reason).",
  "Use close_ticket only when the user explicitly confirms the issue is resolved or explicitly asks to close the ticket.",
  "Never close a ticket immediately after giving advice unless the user confirmed resolution.",
  "If you are unsure, do not close the ticket.",
  "When the tool is not needed, reply normally to the user.",
  "Return strict JSON only. No markdown. No code fences. No extra text.",
  'Valid response A: {"action":"respond","message":"..."}',
  'Valid response B: {"action":"tool_call","tool":"close_ticket","arguments":{"ticketId":"...","reason":"..."},"message_after_tool":"..."}',
  "Always reply in the same language as the latest user message.",
].join(" ");

function detectPreferredLanguage(text) {
  if (/[А-Яа-яЁё]/.test(text)) {
    return "Russian";
  }

  return "English";
}

export function buildSupportActionPrompt({
  ticket,
  summaryPayload,
  messages,
  latestUserMessage,
  ragChunks,
  userContext,
  recentMessagesLimit,
}) {
  const preferredLanguage = detectPreferredLanguage(latestUserMessage);
  const recentMessages = messages.slice(-recentMessagesLimit).map((message) => ({
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
    "Decision rules:",
    "- If user asks a new question, troubleshoot and keep ticket open.",
    "- If user says the problem is fixed, solved, works now, or asks to close the ticket, call close_ticket.",
    "- If user is only thanking you but did not clearly confirm resolution, prefer respond unless resolution is explicit.",
    "- Never mention tool internals to the user.",
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
    "User context from local CRM data:",
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
    "Output contract:",
    '- Respond path: {"action":"respond","message":"assistant reply"}',
    '- Tool path: {"action":"tool_call","tool":"close_ticket","arguments":{"ticketId":"current ticket id","reason":"short reason"},"message_after_tool":"brief confirmation to user"}',
    "- Choose exactly one action.",
  ].join("\n");
}

export { SUPPORT_ACTION_SYSTEM_PROMPT };
