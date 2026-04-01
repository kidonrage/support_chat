import { createId, nowIso } from "../utils/text.js";

export class MessagesRepository {
  constructor(store) {
    this.store = store;
  }

  async listByTicketId(ticketId) {
    const data = await this.store.read();
    return data.messages
      .filter((message) => message.ticketId === ticketId)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }

  async create({ ticketId, role, text }) {
    const message = {
      id: createId("m"),
      ticketId,
      role,
      text,
      createdAt: nowIso(),
    };

    await this.store.update((data) => ({
      ...data,
      messages: [...data.messages, message],
    }));

    return message;
  }
}
