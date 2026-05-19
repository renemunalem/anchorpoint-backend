import { SeedUser } from "../types/models";

export interface UserRepo {
  list(role?: string): Promise<Array<Omit<SeedUser, "password">>>;
  findByEmail(email: string): Promise<SeedUser | null>;
  touchLastLogin(id: string, timestamp: string): Promise<void>;
}
