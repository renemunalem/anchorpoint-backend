import { UserRepo } from "../repos/UserRepo";

export class UsersService {
  constructor(private readonly userRepo: UserRepo) {}

  async getAll(role?: string) {
    return this.userRepo.list(role);
  }
}
