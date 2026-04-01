import { createId, nowIso } from "../utils/text.js";

export class TicketsRepository {
  constructor(store) {
    this.store = store;
  }

  async listByUserId(userId) {
    const data = await this.store.read();
    return data.tickets
      .filter((ticket) => ticket.userId === userId)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }

  async getById(ticketId) {
    const data = await this.store.read();
    return data.tickets.find((ticket) => ticket.id === ticketId) || null;
  }

  async create({ userId }) {
    const timestamp = nowIso();
    const ticket = {
      id: createId("t"),
      userId,
      title: "New ticket",
      status: "open",
      summary: "",
      category: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastMessagePreview: "",
    };

    await this.store.update((data) => ({
      ...data,
      tickets: [ticket, ...data.tickets],
    }));

    return ticket;
  }

  async update(ticketId, patch) {
    let updatedTicket = null;

    await this.store.update((data) => {
      const tickets = data.tickets.map((ticket) => {
        if (ticket.id !== ticketId) {
          return ticket;
        }

        updatedTicket = {
          ...ticket,
          ...patch,
          id: ticket.id,
          userId: ticket.userId,
          createdAt: ticket.createdAt,
          updatedAt: patch.updatedAt || nowIso(),
        };

        return updatedTicket;
      });

      return {
        ...data,
        tickets,
      };
    });

    return updatedTicket;
  }
}
