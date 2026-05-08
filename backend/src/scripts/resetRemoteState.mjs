import { seedData } from "../data/seed.js";
import { readDb, writeDb } from "../repositories/database.js";

await writeDb(seedData);
const data = await readDb();

console.log(
  JSON.stringify({
    users: data.users.length,
    youths: data.youths.length,
    attendanceSessions: data.attendanceSessions.length,
    interactions: data.interactions.length,
    alerts: data.alerts.length
  })
);
