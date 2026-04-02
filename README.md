# Support Chat Demo

Minimal local support assistant with one important MCP tool: `close_ticket`.

Architecture stays deliberately boring:

- frontend sends messages to `POST /api/chat`
- backend stores ticket state and messages in local JSON files
- backend builds summary, RAG context, and user context deterministically
- Ollama decides either:
  - answer normally
  - call `close_ticket`
- backend calls a real MCP server over `stdio`
- MCP server updates the same shared ticket storage used by the backend

No external agent platform. No extra orchestration layer. One tool, one process, one shared source of truth.

## Stack

- Frontend: plain HTML/CSS/JS
- Backend: zero-dependency Node `http` server
- MCP server: separate Node process over `stdio`
- Storage: local JSON files in `runtime/`
- LLM: local Ollama
- Models:
  - chat: `qwen3:8b`
  - summarization: `qwen3:8b`
  - embeddings: `embeddinggemma`

## Why this MCP approach

This project now uses a custom minimal MCP client/server loop instead of `ollama-mcp-bridge`.

Reason:

- the current backend already owns the deterministic support pipeline
- Ollama integration is already local and simple
- only one real tool is needed
- `stdio` MCP is the shortest reliable path here

So the design is:

1. backend asks Ollama for strict JSON action output
2. if Ollama returns `tool_call`, backend invokes the MCP server
3. MCP server closes the ticket in shared storage
4. backend saves final assistant message and returns updated ticket state

## Run

### 1. Start Ollama

```bash
ollama pull qwen3:8b
ollama pull embeddinggemma
ollama serve
```

### 2. Start the MCP server

This is optional if you only run the main backend, because the backend will spawn it automatically on first tool call.

For manual inspection:

```bash
npm run start:mcp
```

### 3. Start the backend

```bash
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Test

```bash
npm test
```

## API

- `GET /api/health`
- `GET /api/tickets?userId=u_001`
- `GET /api/tickets/:ticketId/messages`
- `POST /api/tickets`
- `POST /api/tickets/:ticketId/close`
- `POST /api/chat`

`POST /api/chat` body:

```json
{
  "userId": "u_001",
  "ticketId": null,
  "message": "thanks, it works now"
}
```

Possible response after tool execution:

```json
{
  "ticketId": "t_123",
  "answer": "Glad to hear that the issue is resolved. I have closed this ticket.",
  "ticket": {
    "id": "t_123",
    "title": "Login issue",
    "status": "closed",
    "summary": "User could not sign in, then confirmed the issue is fixed.",
    "closeReason": "User confirmed issue resolved",
    "closedAt": "2026-04-02T10:00:00.000Z",
    "updatedAt": "2026-04-02T10:00:01.000Z"
  }
}
```

## MCP Tools

The standalone MCP server is in [src/server/mcp/tickets-mcp-server.js](/Users/aura/Desktop/support_chat/src/server/mcp/tickets-mcp-server.js).

Tools:

- `close_ticket(ticketId, reason?)`
- `get_ticket_status(ticketId)`

Main behavior of `close_ticket`:

- if ticket does not exist, returns structured error result
- if ticket is already closed, returns structured non-fatal result
- if ticket is open, sets:
  - `status = closed`
  - `closedAt = now`
  - `closeReason = reason`
  - `updatedAt = now`

The MCP client adapter used by the backend is in [src/server/mcp/tickets-mcp-client.js](/Users/aura/Desktop/support_chat/src/server/mcp/tickets-mcp-client.js).

## Pipeline

`POST /api/chat` now works like this:

1. validate `userId`, `ticketId`, and message
2. create ticket if needed
3. store user message
4. update ticket summary
5. retrieve RAG context from `knowledge_base/`
6. load user context from local JSON data
7. ask Ollama for a strict JSON decision:
   - `{"action":"respond","message":"..."}`
   - `{"action":"tool_call","tool":"close_ticket",...}`
8. if Ollama returns `respond`:
   - save assistant message
   - keep ticket open
9. if Ollama returns `tool_call`:
   - backend calls MCP server over `stdio`
   - MCP server updates shared ticket storage
   - backend saves final assistant message
   - backend returns updated closed ticket

Important guardrail:

- backend does not trust the model's `ticketId` blindly
- the tool call is forced onto the active ticket id from the request context

## Prompting Policy

Prompt text is isolated in [src/server/prompts/support-action-prompt.js](/Users/aura/Desktop/support_chat/src/server/prompts/support-action-prompt.js).

Core rules:

- only close when the user explicitly confirms resolution or explicitly asks to close
- never close immediately after assistant advice without confirmation
- when uncertain, keep the ticket open
- return strict JSON only

## Storage

Shared storage is file-based:

- [runtime/tickets.json](/Users/aura/Desktop/support_chat/runtime/tickets.json)
- [runtime/messages.json](/Users/aura/Desktop/support_chat/runtime/messages.json)

The backend and the MCP server both use the same ticket repository format, so a ticket closed through MCP is immediately visible to the backend and UI.

## Error Handling

Handled cases:

- Ollama unavailable: backend returns controlled error instead of crashing
- invalid model JSON: backend falls back to a safe assistant response
- invalid or unknown tool call: backend does not crash and keeps ticket open
- MCP unavailable: backend returns a safe user-facing fallback and leaves ticket open
- ticket not found: structured MCP result, or HTTP `404` on direct backend route
- already closed ticket: graceful structured MCP result

## Audit Logs

Backend logs:

- when model requests `close_ticket`
- arguments passed to the tool
- MCP success or failure
- final ticket status

## Manual Scenario

1. User opens a ticket and writes about a problem.
2. Assistant replies with troubleshooting steps.
3. User writes: `thanks, it works now`
4. Ollama returns a `close_ticket` action
5. Backend calls the MCP server
6. MCP server closes the ticket in shared storage
7. Backend returns assistant confirmation and `ticket.status = "closed"`
