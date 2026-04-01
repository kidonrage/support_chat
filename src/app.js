import { SupportApi, createDraftTicket } from "./support-api.js";

const DEMO_USER_ID = "u_001";
const DRAFT_KEY = "__draft__";
const api = new SupportApi("");

const state = {
  currentUserId: DEMO_USER_ID,
  tickets: [],
  activeTicketKey: null,
  draftTicket: null,
  activeMessages: [],
  draftMessage: "",
  loadingTickets: false,
  loadingMessages: false,
  sending: false,
  creatingTicket: false,
  closingTicket: false,
  listError: "",
  messagesError: "",
  actionError: "",
  composerNotice: "",
  retryAction: null,
};

let refs = {};
let messagesAbortController = null;

bootstrap();

async function bootstrap() {
  buildShell();
  bindStaticEvents();
  render();
  await loadTickets();
}

function buildShell() {
  const app = document.querySelector("#app");

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar__header">
          <div>
            <p class="eyebrow">Support Desk</p>
            <h1>Support chat</h1>
            <p class="sidebar__hint">One conversation equals one ticket.</p>
          </div>
          <button id="new-ticket-button" class="button button--primary" type="button">New ticket</button>
        </div>

        <div id="tickets-error" class="panel-message panel-message--error" hidden>
          <span id="tickets-error-text"></span>
          <button id="tickets-retry-button" class="button button--ghost" type="button">Retry</button>
        </div>

        <div id="tickets-empty" class="empty-state" hidden>
          <h2>No tickets yet</h2>
          <p>Create your first support conversation. A new request always goes into a new ticket.</p>
          <button id="empty-new-ticket-button" class="button button--primary" type="button">Create first ticket</button>
        </div>

        <div id="tickets-loading" class="panel-message" hidden>Loading tickets...</div>
        <div id="tickets-list" class="ticket-list" aria-live="polite"></div>
      </aside>

      <main class="conversation">
        <header class="conversation__header">
          <div>
            <p class="eyebrow">Ticket</p>
            <div class="conversation__title-row">
              <h2 id="ticket-title">Select a ticket</h2>
              <span id="ticket-status" class="status-badge status-badge--muted">Idle</span>
            </div>
            <p id="ticket-meta" class="conversation__meta">Choose an existing ticket or start a new one.</p>
          </div>
          <button id="close-ticket-button" class="button button--ghost" type="button" hidden>Close ticket</button>
        </header>

        <div id="action-banner" class="panel-message panel-message--error" hidden>
          <span id="action-banner-text"></span>
          <button id="action-retry-button" class="button button--ghost" type="button">Retry</button>
        </div>

        <section id="messages-state" class="conversation__state"></section>
        <section id="messages" class="messages" aria-live="polite"></section>

        <form id="composer-form" class="composer">
          <label class="sr-only" for="message-input">Type your message</label>
          <textarea
            id="message-input"
            rows="3"
            maxlength="4000"
            placeholder="Describe your problem"
          ></textarea>

          <div class="composer__footer">
            <p id="composer-note" class="composer__note">Messages are sent as demo user u_001.</p>
            <button id="send-button" class="button button--primary" type="submit">Send</button>
          </div>
        </form>
      </main>
    </div>
  `;

  refs = {
    newTicketButton: document.querySelector("#new-ticket-button"),
    emptyNewTicketButton: document.querySelector("#empty-new-ticket-button"),
    ticketsRetryButton: document.querySelector("#tickets-retry-button"),
    ticketsError: document.querySelector("#tickets-error"),
    ticketsErrorText: document.querySelector("#tickets-error-text"),
    ticketsEmpty: document.querySelector("#tickets-empty"),
    ticketsLoading: document.querySelector("#tickets-loading"),
    ticketsList: document.querySelector("#tickets-list"),
    ticketTitle: document.querySelector("#ticket-title"),
    ticketStatus: document.querySelector("#ticket-status"),
    ticketMeta: document.querySelector("#ticket-meta"),
    closeTicketButton: document.querySelector("#close-ticket-button"),
    actionBanner: document.querySelector("#action-banner"),
    actionBannerText: document.querySelector("#action-banner-text"),
    actionRetryButton: document.querySelector("#action-retry-button"),
    messagesState: document.querySelector("#messages-state"),
    messages: document.querySelector("#messages"),
    composerForm: document.querySelector("#composer-form"),
    messageInput: document.querySelector("#message-input"),
    composerNote: document.querySelector("#composer-note"),
    sendButton: document.querySelector("#send-button"),
  };
}

function bindStaticEvents() {
  refs.newTicketButton.addEventListener("click", handleNewTicket);
  refs.emptyNewTicketButton.addEventListener("click", handleNewTicket);
  refs.ticketsRetryButton.addEventListener("click", () => loadTickets({ force: true }));
  refs.actionRetryButton.addEventListener("click", handleRetryAction);
  refs.closeTicketButton.addEventListener("click", handleCloseTicket);
  refs.composerForm.addEventListener("submit", handleSendMessage);
  refs.messageInput.addEventListener("input", (event) => {
    state.draftMessage = event.target.value;
    syncComposerControls();
  });
  refs.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage(event);
    }
  });
}

function render() {
  renderTicketList();
  renderConversationHeader();
  renderMessages();
  renderActionBanner();
  renderComposer();
}

function getTicketKey(ticket) {
  return ticket.isDraft ? DRAFT_KEY : ticket.id;
}

function getActiveTicket() {
  if (state.activeTicketKey === DRAFT_KEY) {
    return state.draftTicket;
  }

  return state.tickets.find((ticket) => ticket.id === state.activeTicketKey) || null;
}

function sortTickets(tickets) {
  return [...tickets].sort((left, right) => {
    const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
    const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

function getVisibleTickets() {
  const tickets = sortTickets(state.tickets);
  return state.draftTicket ? [state.draftTicket, ...tickets] : tickets;
}

function formatDateTime(value) {
  if (!value) {
    return "No activity yet";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No activity yet";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function createStatusBadge(status) {
  const badge = document.createElement("span");
  const safeStatus = status || "open";
  badge.className =
    safeStatus === "closed" ? "status-badge status-badge--closed" : "status-badge status-badge--open";
  badge.textContent = safeStatus;
  return badge;
}

function renderTicketList() {
  refs.ticketsError.hidden = !state.listError;
  refs.ticketsErrorText.textContent = state.listError;
  refs.ticketsLoading.hidden = !(state.loadingTickets && state.tickets.length === 0 && !state.draftTicket);

  const visibleTickets = getVisibleTickets();
  const showEmptyState = !state.loadingTickets && visibleTickets.length === 0 && !state.listError;
  refs.ticketsEmpty.hidden = !showEmptyState;
  refs.ticketsList.hidden = showEmptyState;

  refs.newTicketButton.disabled = state.creatingTicket || state.sending;
  refs.emptyNewTicketButton.disabled = state.creatingTicket || state.sending;

  refs.ticketsList.replaceChildren();

  visibleTickets.forEach((ticket) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ticket-card";
    item.dataset.ticketKey = getTicketKey(ticket);
    item.disabled = state.sending || state.closingTicket || state.creatingTicket;

    if (state.activeTicketKey === getTicketKey(ticket)) {
      item.classList.add("ticket-card--active");
    }

    const titleRow = document.createElement("div");
    titleRow.className = "ticket-card__header";

    const title = document.createElement("h3");
    title.className = "ticket-card__title";
    title.textContent = ticket.title;

    const timestamp = document.createElement("span");
    timestamp.className = "ticket-card__time";
    timestamp.textContent = formatDateTime(ticket.updatedAt);

    titleRow.append(title, timestamp);

    const preview = document.createElement("p");
    preview.className = "ticket-card__preview";
    preview.textContent = ticket.lastMessagePreview || "No messages yet";

    const footer = document.createElement("div");
    footer.className = "ticket-card__footer";
    footer.append(createStatusBadge(ticket.isDraft ? "open" : ticket.status));

    if (ticket.isDraft) {
      const draftLabel = document.createElement("span");
      draftLabel.className = "ticket-card__draft";
      draftLabel.textContent = "Draft";
      footer.append(draftLabel);
    }

    item.append(titleRow, preview, footer);
    item.addEventListener("click", () => {
      void selectTicket(getTicketKey(ticket));
    });

    refs.ticketsList.append(item);
  });
}

function renderConversationHeader() {
  const activeTicket = getActiveTicket();

  if (!activeTicket) {
    refs.ticketTitle.textContent = "Select a ticket";
    refs.ticketStatus.className = "status-badge status-badge--muted";
    refs.ticketStatus.textContent = "Idle";
    refs.ticketMeta.textContent = "Choose an existing ticket or start a new one.";
    refs.closeTicketButton.hidden = true;
    return;
  }

  refs.ticketTitle.textContent = activeTicket.title;
  refs.ticketStatus.className =
    activeTicket.status === "closed" ? "status-badge status-badge--closed" : "status-badge status-badge--open";
  refs.ticketStatus.textContent = activeTicket.isDraft ? "draft" : activeTicket.status;
  refs.ticketMeta.textContent = activeTicket.isDraft
    ? "This draft will become a real ticket after the first successful message."
    : `Last updated ${formatDateTime(activeTicket.updatedAt)}.`;

  refs.closeTicketButton.hidden = activeTicket.isDraft || activeTicket.status === "closed";
  refs.closeTicketButton.disabled = state.closingTicket || state.sending;
  refs.closeTicketButton.textContent = state.closingTicket ? "Closing..." : "Close ticket";
}

function renderMessages() {
  const activeTicket = getActiveTicket();
  refs.messages.replaceChildren();

  if (!activeTicket) {
    refs.messagesState.textContent = "Select a ticket from the list or create a new one.";
    refs.messagesState.hidden = false;
    return;
  }

  if (state.loadingMessages) {
    refs.messagesState.textContent = "Loading conversation...";
    refs.messagesState.hidden = false;
    return;
  }

  if (state.messagesError) {
    refs.messagesState.hidden = false;
    refs.messagesState.replaceChildren();

    const wrapper = document.createElement("div");
    wrapper.className = "inline-error";

    const text = document.createElement("span");
    text.textContent = state.messagesError;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button--ghost";
    button.textContent = "Retry";
    button.addEventListener("click", () => {
      void loadMessages(activeTicket.id);
    });

    wrapper.append(text, button);
    refs.messagesState.append(wrapper);
    return;
  }

  if (state.activeMessages.length === 0) {
    refs.messagesState.hidden = false;
    refs.messagesState.textContent = activeTicket.isDraft
      ? "Start the conversation. Your first message will create the ticket if it does not exist yet."
      : "No messages yet.";
    return;
  }

  refs.messagesState.hidden = true;

  state.activeMessages.forEach((message) => {
    const bubble = document.createElement("article");
    const roleClass = message.role === "user" ? "message--user" : "message--assistant";
    bubble.className = `message ${roleClass}`;

    if (message.pending || message.loading) {
      bubble.classList.add("message--pending");
    }

    const meta = document.createElement("div");
    meta.className = "message__meta";
    meta.textContent = message.role === "user" ? "You" : "Support";

    const body = document.createElement("p");
    body.className = "message__body";
    body.textContent = message.text;

    bubble.append(meta, body);

    if (message.role === "assistant" && Array.isArray(message.sources) && message.sources.length > 0) {
      const sourcesBlock = document.createElement("div");
      sourcesBlock.className = "message__sources";

      const sourcesLabel = document.createElement("p");
      sourcesLabel.className = "message__sources-label";
      sourcesLabel.textContent = "Sources";
      sourcesBlock.append(sourcesLabel);

      const sourcesList = document.createElement("div");
      sourcesList.className = "message__sources-list";

      message.sources.forEach((source) => {
        const sourceCard = document.createElement("a");
        sourceCard.className = "message__source";
        sourceCard.href = source.url || "#";
        sourceCard.target = "_blank";
        sourceCard.rel = "noreferrer";

        const sourceTitle = document.createElement("span");
        sourceTitle.className = "message__source-title";
        sourceTitle.textContent = source.title || source.source || "Source";

        const sourceMeta = document.createElement("span");
        sourceMeta.className = "message__source-meta";
        sourceMeta.textContent = source.source || "";

        sourceCard.append(sourceTitle);

        if (source.source) {
          sourceCard.append(sourceMeta);
        }

        if (source.excerpt) {
          const sourceExcerpt = document.createElement("span");
          sourceExcerpt.className = "message__source-excerpt";
          sourceExcerpt.textContent = source.excerpt;
          sourceCard.append(sourceExcerpt);
        }

        sourcesList.append(sourceCard);
      });

      sourcesBlock.append(sourcesList);
      bubble.append(sourcesBlock);
    }

    refs.messages.append(bubble);
  });

  requestAnimationFrame(scrollMessagesToBottom);
}

function renderActionBanner() {
  refs.actionBanner.hidden = !state.actionError;
  refs.actionBannerText.textContent = state.actionError;
  refs.actionRetryButton.hidden = !state.retryAction;
}

function renderComposer() {
  const activeTicket = getActiveTicket();
  const composerDisabled =
    !activeTicket || state.loadingMessages || state.sending || activeTicket.status === "closed";

  refs.messageInput.value = state.draftMessage;
  refs.messageInput.disabled = composerDisabled;
  refs.sendButton.disabled = composerDisabled || !state.draftMessage.trim();
  refs.sendButton.textContent = state.sending ? "Sending..." : "Send";

  if (!activeTicket) {
    refs.composerNote.textContent = "Create or select a ticket to start chatting.";
    refs.messageInput.placeholder = "Create or select a ticket";
  } else if (activeTicket.status === "closed") {
    refs.composerNote.textContent = "This ticket is closed. Create a new chat for a new request.";
    refs.messageInput.placeholder = "Closed tickets are read-only";
  } else if (state.composerNotice) {
    refs.composerNote.textContent = state.composerNotice;
    refs.messageInput.placeholder = "Describe your problem";
  } else {
    refs.composerNote.textContent = `Messages are sent as demo user ${state.currentUserId}.`;
    refs.messageInput.placeholder = "Describe your problem";
  }

  refs.composerForm.classList.toggle("composer--disabled", !activeTicket || activeTicket?.status === "closed");
}

function syncComposerControls() {
  const activeTicket = getActiveTicket();
  const composerDisabled =
    !activeTicket || state.loadingMessages || state.sending || activeTicket.status === "closed";
  refs.sendButton.disabled = composerDisabled || !state.draftMessage.trim();
}

function mergeTicket(ticket) {
  const normalizedTicket = {
    ...ticket,
    title: ticket.title || "New ticket",
    status: ticket.status === "closed" ? "closed" : "open",
    lastMessagePreview: ticket.lastMessagePreview || "",
    updatedAt: ticket.updatedAt || new Date().toISOString(),
    isDraft: false,
  };

  const existingIndex = state.tickets.findIndex((item) => item.id === normalizedTicket.id);

  if (existingIndex === -1) {
    state.tickets = [normalizedTicket, ...state.tickets];
    return normalizedTicket;
  }

  state.tickets = state.tickets.map((item) => (item.id === normalizedTicket.id ? { ...item, ...normalizedTicket } : item));
  return normalizedTicket;
}

function updateTicketPreview(ticketId, previewText) {
  state.tickets = state.tickets.map((ticket) =>
    ticket.id === ticketId
      ? {
          ...ticket,
          lastMessagePreview: previewText,
          updatedAt: new Date().toISOString(),
        }
      : ticket
  );
}

function ensureActiveSelection() {
  if (state.activeTicketKey === DRAFT_KEY && state.draftTicket) {
    return;
  }

  if (state.activeTicketKey && state.tickets.some((ticket) => ticket.id === state.activeTicketKey)) {
    return;
  }

  const firstTicket = sortTickets(state.tickets)[0];
  state.activeTicketKey = firstTicket ? firstTicket.id : null;
}

async function loadTickets({ force = false } = {}) {
  if (state.loadingTickets && !force) {
    return;
  }

  state.loadingTickets = true;
  state.listError = "";
  renderTicketList();

  try {
    const tickets = await api.getTickets(state.currentUserId);
    state.tickets = sortTickets(tickets);
    ensureActiveSelection();
    renderTicketList();
    renderConversationHeader();
    renderComposer();

    const activeTicket = getActiveTicket();
    if (activeTicket && activeTicket.id) {
      await loadMessages(activeTicket.id);
    } else {
      state.activeMessages = [];
      renderMessages();
    }
  } catch (error) {
    state.listError = error.message || "Could not load tickets.";
    renderTicketList();
  } finally {
    state.loadingTickets = false;
    renderTicketList();
  }
}

async function selectTicket(ticketKey) {
  state.actionError = "";
  state.retryAction = null;
  state.messagesError = "";
  state.activeTicketKey = ticketKey;
  renderTicketList();
  renderConversationHeader();
  renderComposer();

  const activeTicket = getActiveTicket();

  if (!activeTicket || !activeTicket.id) {
    state.activeMessages = [];
    renderMessages();
    return;
  }

  await loadMessages(activeTicket.id);
}

async function loadMessages(ticketId) {
  if (!ticketId) {
    state.activeMessages = [];
    state.loadingMessages = false;
    state.messagesError = "";
    renderMessages();
    return;
  }

  if (messagesAbortController) {
    messagesAbortController.abort();
  }

  messagesAbortController = new AbortController();
  state.loadingMessages = true;
  state.messagesError = "";
  renderMessages();

  try {
    const messages = await api.getMessages(ticketId, messagesAbortController.signal);
    if (state.activeTicketKey !== ticketId) {
      return;
    }

    state.activeMessages = messages;
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    state.messagesError = error.message || "Could not load messages.";
    state.activeMessages = [];
  } finally {
    state.loadingMessages = false;
    renderMessages();
  }
}

function startLocalDraft(notice = "Send the first message to create the ticket.") {
  state.draftTicket = createDraftTicket();
  state.activeTicketKey = DRAFT_KEY;
  state.activeMessages = [];
  state.messagesError = "";
  state.composerNotice = notice;
  render();
  refs.messageInput.focus();
}

async function createRemoteTicketForDraft() {
  state.creatingTicket = true;
  state.actionError = "";
  state.retryAction = null;
  state.composerNotice = "";
  renderTicketList();
  renderActionBanner();
  renderComposer();

  try {
    const ticket = await api.createTicket(state.currentUserId);

    if (!ticket?.id) {
      startLocalDraft("Send the first message to create the ticket.");
      return;
    }

    const mergedTicket = mergeTicket(ticket);
    state.draftTicket = null;
    state.activeTicketKey = mergedTicket.id;
    state.activeMessages = [];
    render();
  } catch (error) {
    startLocalDraft("Could not pre-create the ticket. It will be created when you send the first message.");
    state.actionError = error.message || "Could not create a new ticket.";
    state.retryAction = { kind: "create-ticket" };
    renderActionBanner();
  } finally {
    state.creatingTicket = false;
    renderTicketList();
    renderConversationHeader();
    renderComposer();
  }
}

async function handleNewTicket() {
  await createRemoteTicketForDraft();
}

function makeTemporaryMessage(role, text, extra = {}) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

async function handleSendMessage(event, retryMessage = null) {
  event?.preventDefault();

  const activeTicket = getActiveTicket();
  const message = (retryMessage ?? state.draftMessage).trim();

  if (!activeTicket || !message || state.sending || activeTicket.status === "closed") {
    return;
  }

  state.sending = true;
  state.actionError = "";
  state.retryAction = null;
  state.composerNotice = "";

  const optimisticUserMessage = makeTemporaryMessage("user", message, { pending: true });
  const loadingReplyMessage = makeTemporaryMessage("assistant", "Support is preparing a reply...", {
    loading: true,
  });

  state.activeMessages = [...state.activeMessages, optimisticUserMessage, loadingReplyMessage];
  state.draftMessage = "";
  renderMessages();
  renderActionBanner();
  renderComposer();

  try {
    const response = await api.sendMessage({
      userId: state.currentUserId,
      ticketId: activeTicket.id,
      message,
    });

    state.activeMessages = state.activeMessages.filter((item) => item.id !== loadingReplyMessage.id);
    state.activeMessages = state.activeMessages.map((item) =>
      item.id === optimisticUserMessage.id ? { ...item, pending: false } : item
    );

    if (response.answer) {
      state.activeMessages.push(
        makeTemporaryMessage("assistant", response.answer, {
          pending: false,
          sources: response.sources || response.assistantMessage?.sources || [],
        })
      );
    }

    const ticketFromResponse = response.ticket || {
      id: response.ticketId,
      title: activeTicket.title,
      status: "open",
    };

    if (ticketFromResponse?.id) {
      const mergedTicket = mergeTicket({
        ...ticketFromResponse,
        lastMessagePreview: response.answer || message,
        updatedAt: new Date().toISOString(),
      });

      if (state.activeTicketKey === DRAFT_KEY) {
        state.draftTicket = null;
      }

      state.activeTicketKey = mergedTicket.id;
      updateTicketPreview(mergedTicket.id, response.answer || message);
    }

    render();
  } catch (error) {
    state.activeMessages = state.activeMessages.filter(
      (item) => item.id !== optimisticUserMessage.id && item.id !== loadingReplyMessage.id
    );
    state.draftMessage = message;
    state.actionError = error.message || "Could not send the message.";
    state.retryAction = {
      kind: "send-message",
      payload: {
        message,
      },
    };
    renderMessages();
    renderActionBanner();
    renderComposer();
  } finally {
    state.sending = false;
    renderConversationHeader();
    renderComposer();
  }
}

async function handleCloseTicket() {
  const activeTicket = getActiveTicket();

  if (!activeTicket?.id || activeTicket.status === "closed" || state.closingTicket) {
    return;
  }

  state.closingTicket = true;
  state.actionError = "";
  state.retryAction = null;
  renderConversationHeader();
  renderActionBanner();

  try {
    const closedTicket = await api.closeTicket(activeTicket.id);
    const updatedTicket = mergeTicket({
      ...activeTicket,
      ...closedTicket,
      id: activeTicket.id,
      status: "closed",
    });
    state.activeTicketKey = updatedTicket.id;
    render();
  } catch (error) {
    state.actionError = error.message || "Could not close the ticket.";
    state.retryAction = { kind: "close-ticket" };
    renderActionBanner();
  } finally {
    state.closingTicket = false;
    renderConversationHeader();
    renderComposer();
  }
}

async function handleRetryAction() {
  if (!state.retryAction) {
    return;
  }

  if (state.retryAction.kind === "send-message") {
    await handleSendMessage(null, state.retryAction.payload.message);
    return;
  }

  if (state.retryAction.kind === "create-ticket") {
    await createRemoteTicketForDraft();
    return;
  }

  if (state.retryAction.kind === "close-ticket") {
    await handleCloseTicket();
  }
}

function scrollMessagesToBottom() {
  refs.messages.scrollTop = refs.messages.scrollHeight;
}
