const now = new Date().toISOString();

export const seedData = {
  meta: {
    churchName: "Ministerio Juvenil Generacion de Gloria",
    createdAt: now,
    updatedAt: now
  },
  users: [],
  userSessions: [],
  passwordResets: [],
  emailVerifications: [],
  accessRequests: [],
  auditLogs: [],
  youths: [],
  visitors: [],
  attendanceSessions: [],
  interactions: [],
  alerts: []
};
