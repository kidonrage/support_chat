import { nowIso, normalizeWhitespace, truncate } from "../utils/text.js";

function normalizeReason(reason) {
  const normalized = normalizeWhitespace(reason || "");
  return normalized ? truncate(normalized, 240) : null;
}

export class TicketToolService {
  constructor({ ticketsRepository }) {
    this.ticketsRepository = ticketsRepository;
  }

  async closeTicket(ticketId, reason) {
    const safeTicketId = String(ticketId || "").trim();
    const safeReason = normalizeReason(reason);

    if (!safeTicketId) {
      return {
        ok: false,
        code: "INVALID_ARGUMENTS",
        ticketId: safeTicketId,
        closed: false,
        status: "invalid",
        reason: safeReason,
        message: "ticketId is required.",
      };
    }

    const ticket = await this.ticketsRepository.getById(safeTicketId);

    if (!ticket) {
      return {
        ok: false,
        code: "TICKET_NOT_FOUND",
        ticketId: safeTicketId,
        closed: false,
        status: "not_found",
        reason: safeReason,
        message: "Ticket not found.",
      };
    }

    if (ticket.status === "closed") {
      return {
        ok: true,
        code: "ALREADY_CLOSED",
        ticketId: ticket.id,
        closed: false,
        alreadyClosed: true,
        status: ticket.status,
        reason: ticket.closeReason || safeReason,
        closedAt: ticket.closedAt || null,
        ticket,
        message: "Ticket is already closed.",
      };
    }

    const timestamp = nowIso();
    const updatedTicket = await this.ticketsRepository.update(ticket.id, {
      status: "closed",
      closedAt: timestamp,
      closeReason: safeReason,
      updatedAt: timestamp,
    });

    return {
      ok: true,
      code: "CLOSED",
      ticketId: updatedTicket.id,
      closed: true,
      status: updatedTicket.status,
      reason: updatedTicket.closeReason || null,
      closedAt: updatedTicket.closedAt || null,
      ticket: updatedTicket,
      message: "Ticket closed.",
    };
  }

  async getTicketStatus(ticketId) {
    const safeTicketId = String(ticketId || "").trim();

    if (!safeTicketId) {
      return {
        ok: false,
        code: "INVALID_ARGUMENTS",
        ticketId: safeTicketId,
        found: false,
        status: "invalid",
        message: "ticketId is required.",
      };
    }

    const ticket = await this.ticketsRepository.getById(safeTicketId);

    if (!ticket) {
      return {
        ok: false,
        code: "TICKET_NOT_FOUND",
        ticketId: safeTicketId,
        found: false,
        status: "not_found",
        message: "Ticket not found.",
      };
    }

    return {
      ok: true,
      code: "FOUND",
      ticketId: ticket.id,
      found: true,
      status: ticket.status,
      closedAt: ticket.closedAt || null,
      reason: ticket.closeReason || null,
      ticket,
    };
  }
}
