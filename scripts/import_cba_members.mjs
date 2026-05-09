import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDb, writeDb } from "../backend/src/repositories/database.js";
import { nowIso } from "../backend/src/utils/helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const inputPath = path.resolve(__dirname, "../outputs/cba_members.json");
const members = JSON.parse(await fs.readFile(inputPath, "utf8"));
const current = await readDb();
const payload = {
  ...current,
  youths: members.map((member, index) => ({
    id: `yth_import_${index + 1}`,
    fullName: member.fullName,
    documentId: member.documentId,
    phone: member.phone,
    email: member.email,
    birthDate: member.birthDate,
    baptized: member.baptized,
    memberRole: member.memberRole,
    age: member.birthDate
      ? Math.max(
          0,
          new Date().getFullYear() -
            new Date(`${member.birthDate}T00:00:00`).getFullYear()
        )
      : 0,
    address: "",
    joinDate: nowIso().slice(0, 10),
    status: member.status || "activo",
    assignedUserId: null,
    notes: member.notes || "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  })),
  attendanceSessions: [],
  interactions: [],
  alerts: []
};

await writeDb(payload);
console.log(
  JSON.stringify({
    imported: payload.youths.length,
    preservedUsers: payload.users.length,
    clearedAttendance: payload.attendanceSessions.length,
    clearedInteractions: payload.interactions.length,
    clearedAlerts: payload.alerts.length
  })
);
