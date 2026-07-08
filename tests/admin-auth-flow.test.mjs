import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gdg-auth-"));
const dataFile = path.join(tmpDir, "database.json");

process.env.DATA_FILE = dataFile;
process.env.JWT_SECRET = "test-secret-for-admin-managed-auth-123456";
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SECRET_KEY = "";
process.env.SUPABASE_ENFORCE_REMOTE = "false";
process.env.AUTH_MAX_FAILED_ATTEMPTS = "5";
process.env.AUTH_LOCK_MINUTES = "15";

const crm = await import("../backend/src/services/crmService.js");
const auth = await import("../backend/src/services/authService.js");

const memberPayload = (overrides = {}) => ({
  fullName: "Ana Miembro",
  documentId: "1000001",
  phone: "3001112233",
  email: "ana@gdg.test",
  birthDate: "2008-04-20",
  baptized: "SI",
  memberRole: "Miembro",
  status: "activo",
  address: "Calle 10",
  notes: "",
  ...overrides
});

test("autenticacion institucional administrada por ADMIN", async (t) => {
  const admin = await crm.bootstrapSystem({
    churchName: "Generacion de Gloria",
    fullName: "Administrador General",
    email: "admin@gdg.test",
    password: "Admin123*"
  });

  await t.test("crear miembro sin rol de acceso no crea usuario", async () => {
    const youth = await crm.createYouth(admin, memberPayload());
    const users = await crm.listUsers(admin);
    assert.equal(users.filter((user) => user.email === "ana@gdg.test").length, 0);
    assert.equal(users.length, 1);
    assert.equal(youth.memberRole, "Miembro");
  });

  let youth = (await crm.listYouths(admin, { search: "Ana", status: "" }))[0];

  await t.test("cambio de rol a Mentor crea usuario sin contrasena", async () => {
    youth = await crm.updateYouth(admin, youth.id, { memberRole: "Mentor" });
    const users = await crm.listUsers(admin);
    const mentor = users.find((user) => user.email === "ana@gdg.test");
    assert.ok(mentor);
    assert.equal(mentor.role, "MENTOR");
    assert.equal(mentor.active, true);
    assert.equal(mentor.passwordAssigned, false);
    assert.equal(mentor.managedFromYouth, true);
  });

  await t.test("sincroniza nombre y correo sin duplicar usuarios", async () => {
    youth = await crm.updateYouth(admin, youth.id, {
      fullName: "Ana Pastoral",
      email: "ana.mentor@gdg.test",
      memberRole: "Mentor"
    });
    const users = await crm.listUsers(admin);
    const synced = users.find((user) => user.linkedYouthId === youth.id);
    assert.equal(synced.fullName, "Ana Pastoral");
    assert.equal(synced.email, "ana.mentor@gdg.test");
    assert.equal(users.filter((user) => user.linkedYouthId === youth.id).length, 1);
  });

  await t.test("usuario sin contrasena no puede iniciar sesion", async () => {
    await assert.rejects(
      () => auth.loginUser({ email: "ana.mentor@gdg.test", password: "Mentor123*" }),
      /pendiente de asignacion de contrasena/i
    );
  });

  await t.test("ADMIN asigna contrasena y el usuario puede ingresar", async () => {
    const mentor = (await crm.listUsers(admin)).find((user) => user.linkedYouthId === youth.id);
    const updated = await crm.updateUser(admin, mentor.id, {
      password: "Mentor123*",
      confirmPassword: "Mentor123*"
    });
    assert.equal(updated.passwordAssigned, true);
    const session = await auth.loginUser({
      email: "ana.mentor@gdg.test",
      password: "Mentor123*"
    });
    assert.equal(session.user.email, "ana.mentor@gdg.test");
    assert.equal(session.user.role, "MENTOR");
  });

  await t.test("cambio de rol a Pastor actualiza permisos", async () => {
    youth = await crm.updateYouth(admin, youth.id, { memberRole: "Pastor" });
    const pastor = (await crm.listUsers(admin)).find((user) => user.linkedYouthId === youth.id);
    assert.equal(pastor.role, "PASTOR");
    assert.ok(pastor.permissions.includes("reports:read"));
  });

  await t.test("perder rol de acceso deja usuario inactivo sin eliminarlo", async () => {
    youth = await crm.updateYouth(admin, youth.id, { memberRole: "Miembro" });
    const inactive = (await crm.listUsers(admin)).find((user) => user.linkedYouthId === youth.id);
    assert.ok(inactive);
    assert.equal(inactive.active, false);
  });

  await t.test("cambios repetidos de rol no duplican usuarios", async () => {
    youth = await crm.updateYouth(admin, youth.id, { memberRole: "Mentor" });
    youth = await crm.updateYouth(admin, youth.id, { memberRole: "Lider" });
    youth = await crm.updateYouth(admin, youth.id, { memberRole: "Diacono" });
    const users = await crm.listUsers(admin);
    assert.equal(users.filter((user) => user.linkedYouthId === youth.id).length, 1);
    assert.equal(users.find((user) => user.linkedYouthId === youth.id).active, false);
  });

  await t.test("frontend y backend no conservan rutas de recuperacion", async () => {
    const appSource = await fs.readFile(path.resolve("frontend/app.js"), "utf8");
    const serverSource = await fs.readFile(path.resolve("backend/src/server.js"), "utf8");
    assert.equal(/forgot-password|reset-password|resetToken|Olvide mi contrasena/i.test(appSource), false);
    assert.equal(/forgot-password|reset-password|access-requests|change-password/i.test(serverSource), false);
  });
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});
