import "server-only";
import { createDb, type Db } from "./client";

let db: Db | undefined;

export function getDb(): Db {
  db ??= createDb(process.env.DATABASE_URL);
  return db;
}
