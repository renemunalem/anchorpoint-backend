import fs from "fs";
import path from "path";
import { createSeedState } from "../../data/seedState";
import { DatabaseState } from "../../types/models";

const dataDir = path.resolve(process.cwd(), "data");
const dbPath = path.join(dataDir, "atlasai-dev.json");

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

export function getDbPath() {
  return dbPath;
}

export function ensureDatabaseFile() {
  ensureDataDir();

  if (!fs.existsSync(dbPath)) {
    const seed = createSeedState();
    fs.writeFileSync(dbPath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  }
}

export function readDatabase(): DatabaseState {
  ensureDatabaseFile();
  return JSON.parse(fs.readFileSync(dbPath, "utf8")) as DatabaseState;
}

export function writeDatabase(state: DatabaseState) {
  ensureDataDir();
  fs.writeFileSync(dbPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function resetDatabase() {
  const seed = createSeedState();
  writeDatabase(seed);
  return seed;
}
