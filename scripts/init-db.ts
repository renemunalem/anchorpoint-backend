import fs from "fs";
import { getDbPath, resetDatabase } from "../src/repos/json/jsonStore";

const dbPath = getDbPath();
const existed = fs.existsSync(dbPath);

resetDatabase();

console.log(
  existed
    ? `Reset AtlasAI dev DB at ${dbPath}`
    : `Initialized AtlasAI dev DB at ${dbPath}`,
);
