import { SeedUser } from "../types/models";

export const users: SeedUser[] = [
  {
    id: "usr_admin_001",
    firstName: "Admin",
    lastName: "User",
    email: "admin@atlasai.local",
    password: "change_me",
    role: "Admin",
    status: "Active",
  },
  {
    id: "usr_agent_001",
    firstName: "Avery",
    lastName: "Stone",
    email: "agent1@atlasai.local",
    password: "change_me",
    role: "Agent",
    status: "Active",
  },
  {
    id: "usr_agent_002",
    firstName: "Jordan",
    lastName: "Lee",
    email: "agent2@atlasai.local",
    password: "change_me",
    role: "Agent",
    status: "Active",
  },
  {
    id: "usr_agent_one",
    firstName: "Agent",
    lastName: "One",
    email: "agent.one@atlasai.local",
    password: "change_me",
    role: "Agent",
    status: "Active",
  },
];
