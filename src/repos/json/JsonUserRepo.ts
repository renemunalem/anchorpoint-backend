import { UserRepo } from "../UserRepo";
import { readDatabase, writeDatabase } from "./jsonStore";

export class JsonUserRepo implements UserRepo {
  async list(role?: string) {
    const normalizedRole = role?.trim().toLowerCase();

    return readDatabase().users
      .filter((entry) => {
        if (!normalizedRole) {
          return true;
        }

        return entry.role.toLowerCase() === normalizedRole;
      })
      .map(({ password: _password, ...user }) => user);
  }

  async findByEmail(email: string) {
    return readDatabase().users.find((entry) => entry.email === email) ?? null;
  }

  async touchLastLogin(id: string, timestamp: string) {
    const db = readDatabase();
    const user = db.users.find((entry) => entry.id === id);

    if (!user) {
      return;
    }

    user.lastLogin = timestamp;
    writeDatabase(db);
  }
}
