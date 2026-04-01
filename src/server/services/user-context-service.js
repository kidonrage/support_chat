import fs from "node:fs/promises";

export class UserContextService {
  constructor({ usersFilePath }) {
    this.usersFilePath = usersFilePath;
  }

  async readUsers() {
    const raw = await fs.readFile(this.usersFilePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.users) ? data.users : [];
  }

  async getUserById(userId) {
    const users = await this.readUsers();
    return users.find((user) => user.id === userId) || null;
  }

  async getUserAccountContext(userId) {
    const user = await this.getUserById(userId);

    if (!user) {
      return null;
    }

    return {
      accountId: user.accountId,
      fullName: user.fullName,
      email: user.email,
      plan: user.plan,
      accountStatus: user.accountStatus,
      locale: user.locale,
      timezone: user.timezone,
      joinedAt: user.joinedAt,
      lastLoginAt: user.lastLoginAt,
      billingState: user.billingState,
      subscriptionRenewalAt: user.subscriptionRenewalAt,
    };
  }

  async getUserRecentSignals(userId) {
    const user = await this.getUserById(userId);
    return user?.recentSignals || [];
  }

  async buildContext(userId) {
    const [user, accountContext, recentSignals] = await Promise.all([
      this.getUserById(userId),
      this.getUserAccountContext(userId),
      this.getUserRecentSignals(userId),
    ]);

    return {
      found: Boolean(user),
      user,
      accountContext,
      recentSignals,
    };
  }
}
