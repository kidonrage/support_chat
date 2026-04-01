# Support Chat Frontend

Minimal front-end for a support mini-service where one chat is always one ticket.

## Added files

- `index.html` boots the application shell.
- `src/app.js` contains the UI, state management, and product logic for tickets/messages.
- `src/support-api.js` is a small HTTP client for the support backend.
- `src/styles.css` contains the layout and chat styling.
- `package.json` adds a zero-dependency static serve command.

## Product logic

- Every conversation is tied to exactly one ticket.
- The left column shows all tickets for `u_001` with title, preview, status, and `updatedAt`.
- The right side shows the selected ticket history.
- Closed tickets are read-only. The composer is disabled and the user is told to create a new chat.
- `New ticket` tries `POST /api/tickets` first. If the backend does not return a usable ticket yet, the UI falls back to a local draft and creates the real ticket on the first successful `POST /api/chat`.
- The first successful chat response stores the returned `ticketId` and keeps using it for later messages.

## Expected backend endpoints

- `GET /api/tickets?userId=u_001`
- `GET /api/tickets/{ticketId}/messages`
- `POST /api/chat`
- `POST /api/tickets`
- `POST /api/tickets/{ticketId}/close`

Expected `POST /api/chat` request body:

```json
{
  "userId": "u_001",
  "ticketId": "t_123",
  "message": "text"
}
```

Expected response shape:

```json
{
  "ticketId": "t_123",
  "answer": "text",
  "ticket": {
    "id": "t_123",
    "title": "Login issue",
    "status": "open"
  }
}
```

## Local run

Start any static file server from the project root so browser requests to `/api/*` can be proxied or served by the real backend. One simple option:

```bash
npm start
```
