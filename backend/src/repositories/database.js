import fs from "node:fs/promises";
import { env } from "../config/env.js";
import { seedData } from "../data/seed.js";

let cache = null;
let lastStorageStatus = {
  activeDriver: env.storageDriver,
  intendedDriver: env.storageDriver,
  lastError: "",
  ready: env.storageDriver === "file"
};

const clone = (value) => structuredClone(value);

const inferBirthDate = (youth) => {
  if (youth.birthDate) return youth.birthDate;
  if (youth.fechaDeNacimiento) return youth.fechaDeNacimiento;
  const age = Number(youth.age);
  if (Number.isFinite(age) && age > 0 && age < 120) {
    return `${new Date().getFullYear() - age}-01-01`;
  }
  return "2000-01-01";
};

const normalizeData = (data) => ({
  meta: {
    ...seedData.meta,
    ...(data.meta || {})
  },
  users: Array.isArray(data.users)
    ? data.users.map((user) => ({
        assignedYouthIds: [],
        active: true,
        emailVerified: true,
        mustChangePassword: false,
        lastLogin: null,
        ...user,
        email: String(user.email || "").toLowerCase(),
        assignedYouthIds: Array.isArray(user.assignedYouthIds)
          ? user.assignedYouthIds
          : []
      }))
    : [],
  userSessions: Array.isArray(data.userSessions) ? data.userSessions : [],
  passwordResets: Array.isArray(data.passwordResets) ? data.passwordResets : [],
  emailVerifications: Array.isArray(data.emailVerifications) ? data.emailVerifications : [],
  accessRequests: Array.isArray(data.accessRequests) ? data.accessRequests : [],
  auditLogs: Array.isArray(data.auditLogs) ? data.auditLogs : [],
  youths: Array.isArray(data.youths)
    ? data.youths.map((youth) => {
        const birthDate = inferBirthDate(youth);
        const currentAge = Number(youth.age);
        const birthYear = Number(birthDate.slice(0, 4));
        const derivedAge =
          Number.isFinite(currentAge) && currentAge > 0
            ? currentAge
            : Math.max(0, new Date().getFullYear() - birthYear);
        return {
          email: "",
          address: "",
          notes: "",
          status: "activo",
          assignedUserId: null,
          ...youth,
          age: derivedAge,
          documentId:
            youth.documentId ||
            youth.cedula ||
            youth.documento ||
            `SIN-DOCUMENTO-${youth.id || "LEGADO"}`,
          birthDate,
          baptized: youth.baptized || youth.bautizado || "NO",
          memberRole: youth.memberRole || youth.rolMiembro || youth.rol || "Miembro",
          updatedAt: youth.updatedAt || youth.createdAt || new Date().toISOString()
        };
      })
    : [],
  visitors: Array.isArray(data.visitors)
    ? data.visitors.map((visitor) => ({
        status: "nuevo",
        address: "",
        phone: "",
        notes: "",
        ...visitor,
        updatedAt: visitor.updatedAt || visitor.createdAt || new Date().toISOString()
      }))
    : [],
  attendanceSessions: Array.isArray(data.attendanceSessions)
    ? data.attendanceSessions
    : [],
  interactions: Array.isArray(data.interactions) ? data.interactions : [],
  alerts: Array.isArray(data.alerts) ? data.alerts : []
});

const ensureLocalFile = async () => {
  try {
    await fs.access(env.dataFile);
  } catch {
    await fs.writeFile(env.dataFile, JSON.stringify(seedData, null, 2), "utf8");
  }
};

const markLocalReady = () => {
  lastStorageStatus = {
    ...lastStorageStatus,
    activeDriver: "file",
    lastError: env.storageDriver === "file" ? "" : lastStorageStatus.lastError,
    ready: true
  };
};

const readLocalDb = async () => {
  await ensureLocalFile();
  if (cache) {
    markLocalReady();
    return clone(cache);
  }
  const raw = await fs.readFile(env.dataFile, "utf8");
  cache = normalizeData(JSON.parse(raw));
  markLocalReady();
  return clone(cache);
};

const writeLocalDb = async (data) => {
  cache = normalizeData(data);
  await fs.writeFile(env.dataFile, JSON.stringify(cache, null, 2), "utf8");
  lastStorageStatus = {
    ...lastStorageStatus,
    activeDriver: "file",
    ready: true
  };
  return clone(cache);
};

const getSupabaseApiKey = () => {
  if (env.supabaseSecretKey) return env.supabaseSecretKey;
  if (env.allowInsecurePublishableWrite && env.supabasePublishableKey) {
    return env.supabasePublishableKey;
  }
  return "";
};

const isSupabaseEnabled = () =>
  env.storageDriver === "supabase" && Boolean(env.supabaseUrl && getSupabaseApiKey());

const supabaseHeaders = (extra = {}) => {
  const apiKey = getSupabaseApiKey();
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...extra
  };
};

const supabaseEndpoint = (suffix = "") =>
  `${env.supabaseUrl}/rest/v1/${env.supabaseTable}${suffix}`;

const mapSupabaseError = (error) => {
  const raw = String(error?.message || error);
  if (raw.toLowerCase().includes("fetch failed")) {
    return "No fue posible conectarse con Supabase desde este equipo. Revisa internet, DNS, firewall o la URL del proyecto.";
  }
  if (raw.includes("SUPABASE_READ_FAILED:404")) {
    return "La tabla remota de Supabase no existe. Ejecuta docs/supabase-schema.sql en el SQL Editor.";
  }
  if (raw.includes("SUPABASE_WRITE_FAILED:404")) {
    return "Supabase esta configurado pero la tabla remota no existe para guardar informacion.";
  }
  if (raw.includes("SUPABASE_READ_FAILED:401") || raw.includes("SUPABASE_WRITE_FAILED:401")) {
    return "La clave de Supabase no es valida para este proyecto.";
  }
  if (raw.includes("SUPABASE_READ_FAILED:403") || raw.includes("SUPABASE_WRITE_FAILED:403")) {
    return "Supabase rechazo el acceso. Revisa permisos, RLS o la clave segura.";
  }
  return raw;
};

const upsertRemoteRow = async (payload) => {
  const response = await fetch(supabaseEndpoint("?on_conflict=id"), {
    method: "POST",
    headers: supabaseHeaders({
      Prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify([
      {
        id: env.supabaseRecordId,
        payload,
        updated_at: new Date().toISOString()
      }
    ])
  });

  if (!response.ok) {
    throw new Error(`SUPABASE_WRITE_FAILED:${response.status}`);
  }
};

const readRemoteDb = async () => {
  if (cache) return clone(cache);
  const response = await fetch(
    supabaseEndpoint(
      `?id=eq.${encodeURIComponent(env.supabaseRecordId)}&select=payload`
    ),
    {
      headers: supabaseHeaders()
    }
  );

  if (!response.ok) {
    throw new Error(`SUPABASE_READ_FAILED:${response.status}`);
  }

  const rows = await response.json();
  if (!rows.length) {
    cache = normalizeData(seedData);
    await upsertRemoteRow(cache);
    lastStorageStatus = {
      ...lastStorageStatus,
      activeDriver: "supabase",
      lastError: "",
      ready: true
    };
    return clone(cache);
  }

  cache = normalizeData(rows[0].payload);
  lastStorageStatus = {
    ...lastStorageStatus,
    activeDriver: "supabase",
    lastError: "",
    ready: true
  };
  return clone(cache);
};

const writeRemoteDb = async (data) => {
  cache = normalizeData(data);
  await upsertRemoteRow(cache);
  lastStorageStatus = {
    ...lastStorageStatus,
    activeDriver: "supabase",
    lastError: "",
    ready: true
  };
  return clone(cache);
};

const setRemoteFailure = (error) => {
  lastStorageStatus = {
    intendedDriver: "supabase",
    activeDriver: env.supabaseEnforceRemote ? "supabase" : "file",
    lastError: mapSupabaseError(error),
    ready: false
  };
};

export const readDb = async () => {
  if (isSupabaseEnabled()) {
    try {
      return await readRemoteDb();
    } catch (error) {
      setRemoteFailure(error);
      if (env.supabaseEnforceRemote) {
        const failure = new Error(lastStorageStatus.lastError);
        failure.status = 503;
        throw failure;
      }
      return readLocalDb();
    }
  }
  return readLocalDb();
};

export const writeDb = async (data) => {
  if (isSupabaseEnabled()) {
    try {
      return await writeRemoteDb(data);
    } catch (error) {
      setRemoteFailure(error);
      if (env.supabaseEnforceRemote) {
        const failure = new Error(lastStorageStatus.lastError);
        failure.status = 503;
        throw failure;
      }
      return writeLocalDb(data);
    }
  }
  return writeLocalDb(data);
};

export const probeStorage = async () => {
  try {
    await readDb();
    return getStorageInfo();
  } catch (error) {
    return {
      ...getStorageInfo(),
      lastError: mapSupabaseError(error),
      ready: false
    };
  }
};

export const getStorageInfo = () => ({
  driver: lastStorageStatus.activeDriver,
  intendedDriver: lastStorageStatus.intendedDriver,
  supabaseUrlConfigured: Boolean(env.supabaseUrl),
  publishableKeyConfigured: Boolean(env.supabasePublishableKey),
  serverKeyConfigured: Boolean(env.supabaseSecretKey),
  allowInsecurePublishableWrite: env.allowInsecurePublishableWrite,
  supabaseEnforceRemote: env.supabaseEnforceRemote,
  pendingSupabaseConfig:
    Boolean(env.supabasePublishableKey) &&
    (!env.supabaseUrl || (!env.supabaseSecretKey && !env.allowInsecurePublishableWrite)),
  lastError: lastStorageStatus.lastError,
  ready: lastStorageStatus.ready
});
