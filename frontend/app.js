import React, { useEffect, useMemo, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import htm from "https://esm.sh/htm@3";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const html = htm.bind(React.createElement);
const apiBase = "https://crm-generacion-de-gloria.up.railway.app/api";

const tabs = [
  { key: "dashboard", label: "Dashboard", permission: "dashboard:view" },
  { key: "youths", label: "Miembros", permission: "members:view" },
  { key: "attendance", label: "Asistencia", permission: "attendance:view" },
  { key: "interactions", label: "Seguimiento", permission: "interactions:view" },
  { key: "alerts", label: "Alertas", permission: "alerts:view" },
  { key: "users", label: "Usuarios", permission: "users:view" }
];

const tokenKey = "gdg_crm_token";
const themeKey = "gdg_crm_theme";

const classNames = (...values) => values.filter(Boolean).join(" ");

const hasPermission = (user, permission) =>
  Boolean(user?.permissions?.includes(permission));

const normalizeHeader = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

const normalizeMemberRole = (value) => {
  const normalized = normalizeHeader(value);
  const map = {
    admin: "Administrador",
    administrador: "Administrador",
    administradora: "Administrador",
    pastor: "Pastor",
    pastora: "Pastor",
    miembro: "Miembro",
    lider: "Lider",
    co_lider: "Lider",
    colider: "Lider",
    mentor: "Mentor"
  };
  return map[normalized] || "Miembro";
};

const parseExcelDate = (value) => {
  if (!value) return "";
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const months = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    setiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12"
  };
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const parts = normalized.replace(/\s+de\s+/g, " ").split(/\s+/);
  if (parts.length >= 3 && months[parts[1]]) {
    return `${parts[2]}-${months[parts[1]]}-${String(parts[0]).padStart(2, "0")}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const firstRecordValue = (record, aliases, fallback = "") => {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    const value = record[key];
    if (value !== undefined && String(value || "").trim() !== "") {
      return value;
    }
  }
  return fallback;
};

const normalizeMemberStatus = (value) => {
  const normalized = normalizeHeader(value);
  return normalized === "inactivo" ? "inactivo" : "activo";
};

const parseWorkbookMembers = async (file) => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetNames = [
    ...workbook.SheetNames.filter((name) =>
      ["base_de_datos", "jovenes"].includes(normalizeHeader(name))
    ),
    ...workbook.SheetNames
  ].filter((name, index, names) => names.indexOf(name) === index);

  const compatibleHeaders = {
    name: new Set(["nombre", "nombre_completo", "full_name", "fullname"]),
    document: new Set(["cedula", "documento", "document_id", "documentid"])
  };

  const match = sheetNames
    .map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      const headerRowIndex = rows.findIndex((row) => {
        if (!Array.isArray(row)) return false;
        const headers = row.map(normalizeHeader);
        return (
          headers.some((header) => compatibleHeaders.name.has(header)) &&
          headers.some((header) => compatibleHeaders.document.has(header))
        );
      });
      return headerRowIndex === -1 ? null : { rows, headerRowIndex };
    })
    .find(Boolean);

  if (!match) {
    throw new Error("No se encontro una hoja con encabezados compatibles en el Excel.");
  }

  const headers = match.rows[match.headerRowIndex].map(normalizeHeader);
  const dataRows = match.rows.slice(match.headerRowIndex + 1).filter((row) =>
    Array.isArray(row) && row.some((cell) => String(cell || "").trim() !== "")
  );
  return dataRows.map((row, index) => {
    const record = Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""]));
    const fullName = firstRecordValue(record, ["nombre_completo", "nombre", "full_name"]);
    const documentId = firstRecordValue(record, ["cedula", "documento", "document_id"]);
    const phone = firstRecordValue(record, ["celular", "telefono", "phone"]);
    const birthDate = firstRecordValue(record, [
      "fecha_de_nacimiento",
      "fecha_nacimiento",
      "birth_date"
    ]);
    return {
      fullName: String(fullName || "").trim(),
      documentId: String(documentId || "").trim(),
      phone: String(phone || "").trim(),
      email: String(firstRecordValue(record, ["correo", "email"]) || "").trim().toLowerCase(),
      birthDate: parseExcelDate(birthDate),
      baptized: String(firstRecordValue(record, ["bautizados", "bautizado"], "NO"))
        .trim()
        .toUpperCase() === "SI" ? "SI" : "NO",
      memberRole: normalizeMemberRole(firstRecordValue(record, ["rol", "rol_miembro"], "Miembro")),
      status: normalizeMemberStatus(firstRecordValue(record, ["estado", "status"], "activo")),
      notes: String(firstRecordValue(record, ["notas", "notes"]) || "").trim(),
      importOrder: index + 1
    };
  }).filter((item) => item.fullName && item.documentId);
};

const request = async (path, { method = "GET", token, body, raw = false } = {}) => {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    let message = "Error de servidor.";
    try {
      const data = await response.json();
      message = data.message || message;
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  if (raw) return response;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json")
    ? response.json()
    : response.text();
};

const useTheme = () => {
  const initial = localStorage.getItem(themeKey) || "light";
  const [theme, setTheme] = useState(initial);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(themeKey, theme);
  }, [theme]);
  return [theme, setTheme];
};

const formatDate = (value) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString("es-CO") : "-";

const badgeClasses = {
  activo: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  inactivo: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  pendiente: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  atendida: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  ADMIN: "bg-brand-500/15 text-brand-800 dark:text-brand-300",
  PASTOR: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  LIDER: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  MENTOR: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  MIEMBRO: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  Administrador: "bg-brand-500/15 text-brand-800 dark:text-brand-300",
  Pastor: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  Miembro: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  Lider: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Mentor: "bg-sky-500/15 text-sky-700 dark:text-sky-300"
};

const StatCard = ({ label, value, accent, detail }) => html`
  <div className="panel fade-in rounded-2xl p-5 shadow-soft">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">${label}</p>
        <h3 className="mt-2 font-heading text-3xl font-extrabold tracking-tight">${value}</h3>
      </div>
      <div className=${classNames("h-12 w-12 rounded-2xl", accent)}></div>
    </div>
    <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">${detail}</p>
  </div>
`;

const MiniBarChart = ({ items }) => {
  const max = Math.max(...items.map((item) => item.percent), 100);
  return html`
    <div className="panel rounded-2xl p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-lg font-bold">Tendencia de asistencia</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Ultimas reuniones registradas</p>
        </div>
      </div>
      <div className="mt-6 grid h-64 grid-cols-8 gap-3">
        ${items.map(
          (item) => html`
            <div className="flex h-full flex-col justify-end gap-3">
              <div className="grid-bg relative flex-1 rounded-2xl bg-slate-100/80 p-2 dark:bg-slate-900/70">
                <div
                  className="absolute inset-x-2 bottom-2 rounded-xl bg-gradient-to-t from-brand-700 to-brand-400"
                  style=${{ height: `${Math.max(12, (item.percent / max) * 100)}%` }}
                ></div>
              </div>
              <div className="text-center text-xs text-slate-500">
                <div>${item.percent}%</div>
                <div>${new Date(`${item.date}T00:00:00`).toLocaleDateString("es-CO", {
                  month: "short",
                  day: "numeric"
                })}</div>
              </div>
            </div>
          `
        )}
      </div>
    </div>
  `;
};

const Modal = ({ open, title, onClose, children, wide = false }) => {
  if (!open) return null;
  return html`
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
      <div className=${classNames("panel fade-in max-h-[90vh] overflow-auto rounded-3xl shadow-soft", wide ? "w-full max-w-5xl" : "w-full max-w-2xl")}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-6 py-4 backdrop-blur dark:border-slate-800 dark:bg-night/80">
          <h3 className="font-heading text-xl font-bold">${title}</h3>
          <button className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-slate-900" onClick=${onClose}>Cerrar</button>
        </div>
        <div className="p-6">${children}</div>
      </div>
    </div>
  `;
};

const Input = ({ label, ...props }) => html`
  <label className="flex flex-col gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
    <span>${label}</span>
    <input
      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"
      ...${props}
    />
  </label>
`;

const Select = ({ label, children, ...props }) => html`
  <label className="flex flex-col gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
    <span>${label}</span>
    <select
      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"
      ...${props}
    >
      ${children}
    </select>
  </label>
`;

const Textarea = ({ label, ...props }) => html`
  <label className="flex flex-col gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
    <span>${label}</span>
    <textarea
      className="min-h-[120px] rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"
      ...${props}
    ></textarea>
  </label>
`;

const EmptyState = ({ title, detail }) => html`
  <div className="panel rounded-2xl p-10 text-center shadow-soft">
    <h3 className="font-heading text-lg font-bold">${title}</h3>
    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">${detail}</p>
  </div>
`;

const App = () => {
  const [theme, setTheme] = useTheme();
  const [token, setToken] = useState(localStorage.getItem(tokenKey) || "");
  const [user, setUser] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [healthInfo, setHealthInfo] = useState(null);
  const [setupInfo, setSetupInfo] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [dashboard, setDashboard] = useState(null);
  const [youths, setYouths] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [interactions, setInteractions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [users, setUsers] = useState([]);
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [showYouthModal, setShowYouthModal] = useState(false);
  const [editingYouth, setEditingYouth] = useState(null);
  const [showInteractionModal, setShowInteractionModal] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);

  const availableTabs = useMemo(
    () => tabs.filter((tab) => hasPermission(user, tab.permission)),
    [user]
  );

  const mentorOptions = useMemo(
    () =>
      youths.filter(
        (youth) =>
          ["Pastor", "Lider", "Mentor"].includes(youth.memberRole) &&
          youth.status !== "inactivo" &&
          youth.accountId &&
          youth.id !== editingYouth?.id
      ),
    [youths, editingYouth]
  );

  const showMessage = (message) => {
    setNotice(message);
    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(() => setNotice(""), 2500);
  };

  const loadDashboard = async (authToken = token) => {
    setDashboard(await request("/dashboard", { token: authToken }));
  };

  const loadYouths = async (authToken = token, params = filters) => {
    const query = new URLSearchParams(params).toString();
    setYouths(await request(`/youths?${query}`, { token: authToken }));
  };

  const loadAttendance = async (authToken = token) => {
    setAttendance(await request("/attendance", { token: authToken }));
  };

  const loadInteractions = async (authToken = token) => {
    setInteractions(await request("/interactions", { token: authToken }));
  };

  const loadAlerts = async (authToken = token) => {
    setAlerts(await request("/alerts", { token: authToken }));
  };

  const loadUsers = async (authToken = token) => {
    if (hasPermission(user, "users:view")) {
      setUsers(await request("/users", { token: authToken }));
    }
  };

  const bootstrap = async (authToken = token) => {
    if (!authToken) return;
    setLoading(true);
    try {
      const me = await request("/me", { token: authToken });
      setUser(me.user);
      setSystemInfo(me.system || null);
      await Promise.all([
        loadDashboard(authToken),
        loadYouths(authToken, filters),
        loadAttendance(authToken),
        loadInteractions(authToken),
        loadAlerts(authToken)
      ]);
      if (hasPermission(me.user, "users:view")) {
        setUsers(await request("/users", { token: authToken }));
      }
      setError("");
    } catch (err) {
      localStorage.removeItem(tokenKey);
      setToken("");
      setUser(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    request("/health")
      .then((data) => {
        setHealthInfo(data);
        setSetupInfo(data.setup || null);
      })
      .catch(() => setHealthInfo(null));
  }, []);

  useEffect(() => {
    if (!token || !user) return;
    loadYouths();
  }, [filters.search, filters.status]);

  const refreshAll = async () => {
    await Promise.all([
      loadDashboard(),
      loadYouths(),
      loadAttendance(),
      loadInteractions(),
      loadAlerts(),
      hasPermission(user, "users:view") ? loadUsers() : Promise.resolve()
    ]);
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      const data = await request("/auth/login", {
        method: "POST",
        body: {
          email: form.get("email"),
          password: form.get("password")
        }
      });
      localStorage.setItem(tokenKey, data.token);
      setToken(data.token);
      setUser(data.user);
      await bootstrap(data.token);
      showMessage("Sesion iniciada correctamente.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrap = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      await request("/setup/bootstrap", {
        method: "POST",
        body: {
          churchName: form.get("churchName"),
          fullName: form.get("fullName"),
          email: form.get("email"),
          password: form.get("password")
        }
      });
      const refreshed = await request("/health");
      setHealthInfo(refreshed);
      setSetupInfo(refreshed.setup || null);
      setError("");
      showMessage("Administrador inicial creado. Ya puedes iniciar sesion.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(tokenKey);
    setToken("");
    setUser(null);
    setDashboard(null);
    setEditingUser(null);
    setActiveTab("dashboard");
  };

  const submitYouth = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.age = Number(payload.age);
    try {
      if (editingYouth) {
        await request(`/youths/${editingYouth.id}`, {
          method: "PUT",
          token,
          body: payload
        });
        showMessage("Joven actualizado.");
      } else {
        await request("/youths", { method: "POST", token, body: payload });
        showMessage("Joven registrado.");
      }
      setShowYouthModal(false);
      setEditingYouth(null);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeYouth = async (id) => {
    if (!window.confirm("Esta accion eliminara el joven seleccionado.")) return;
    try {
      await request(`/youths/${id}`, { method: "DELETE", token });
      showMessage("Joven eliminado.");
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const openTimeline = async (youthId) => {
    try {
      setTimeline(await request(`/youths/${youthId}/timeline`, { token }));
    } catch (err) {
      setError(err.message);
    }
  };

  const submitAttendance = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const entries = youths.map((youth) => ({
      youthId: youth.id,
      present: form.get(`attendance_${youth.id}`) === "on"
    }));
    try {
      await request("/attendance", {
        method: "POST",
        token,
        body: {
          title: form.get("title"),
          serviceType: form.get("serviceType"),
          date: form.get("date"),
          notes: form.get("notes"),
          attendance: entries
        }
      });
      setShowAttendanceModal(false);
      showMessage("Asistencia registrada.");
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const submitInteraction = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request("/interactions", {
        method: "POST",
        token,
        body: Object.fromEntries(form.entries())
      });
      setShowInteractionModal(false);
      showMessage("Seguimiento registrado.");
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const markAlertAttended = async (alertId) => {
    try {
      await request(`/alerts/${alertId}/attend`, { method: "PATCH", token });
      showMessage("Alerta marcada como atendida.");
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const submitUser = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assignedYouthIds = form.getAll("assignedYouthIds");
    const password = String(form.get("password") || "");
    const payload = {
      fullName: form.get("fullName"),
      email: form.get("email"),
      role: form.get("role"),
      assignedYouthIds,
      active: form.get("active") === "on"
    };
    if (password) {
      payload.password = password;
    }
    try {
      if (editingUser) {
        await request(`/users/${editingUser.id}`, { method: "PUT", token, body: payload });
        showMessage("Usuario actualizado.");
      } else {
        await request("/users", { method: "POST", token, body: payload });
        showMessage("Usuario creado.");
      }
      setShowUserModal(false);
      setEditingUser(null);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeUser = async (id) => {
    if (!window.confirm("Se eliminara el usuario seleccionado.")) return;
    try {
      await request(`/users/${id}`, { method: "DELETE", token });
      showMessage("Usuario eliminado.");
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const exportYouths = async () => {
    try {
      const response = await request("/export/youths", { token, raw: true });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "jovenes-generacion-de-gloria.xls";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const importCsv = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request("/import/youths", {
        method: "POST",
        token,
        body: { csv: form.get("csv") }
      });
      setShowImportModal(false);
      showMessage("Base de jovenes importada.");
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const importWorkbook = async (event) => {
    event.preventDefault();
    if (!importFile) {
      setError("Selecciona un archivo Excel antes de importar.");
      return;
    }
    if (
      !window.confirm(
        "Esta importacion reemplazara la lista de miembros actual y limpiara asistencias, seguimientos y alertas relacionadas."
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const members = await parseWorkbookMembers(importFile);
      if (!members.length) {
        throw new Error("El archivo no contiene miembros validos para importar.");
      }
      await request("/import/members", {
        method: "POST",
        token,
        body: { members }
      });
      setShowImportModal(false);
      setImportFile(null);
      showMessage(`Se importaron ${members.length} miembros desde Excel.`);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return html`
      <main className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden bg-ink lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(132,151,74,0.28),transparent_32%),linear-gradient(135deg,_#101828,_#1e293b)]"></div>
          <div className="relative flex h-full flex-col justify-between p-12 text-white">
            <div className="flex items-center gap-4">
              <img src="/assets/brand.svg" alt="Generacion de Gloria" className="h-14 w-14 rounded-2xl" />
              <div>
                <p className="font-heading text-2xl font-extrabold">Generacion de Gloria</p>
                <p className="text-sm text-slate-300">CRM pastoral del ministerio juvenil</p>
              </div>
            </div>
            <div className="max-w-xl">
              <p className="font-heading text-5xl font-extrabold leading-tight">
                Seguimiento real, asistencia clara y trabajo pastoral ordenado.
              </p>
              <p className="mt-6 text-lg text-slate-300">
                Una plataforma sobria para cuidar personas, coordinar lideres y detectar
                oportunidades de acompanamiento con rapidez.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              ${[
                ["Alertas activas", "Detecta 2 ausencias consecutivas"],
                ["Roles seguros", "Permisos reales por rol ministerial"],
                ["Exportacion", "Base de jovenes lista para Excel"]
              ].map(
                ([title, text]) => html`
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                    <p className="font-semibold">${title}</p>
                    <p className="mt-2 text-sm text-slate-300">${text}</p>
                  </div>
                `
              )}
            </div>
          </div>
        </section>
        <section className="flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md panel rounded-[28px] p-8 shadow-soft">
            <div className="mb-8">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-300">
                Acceso seguro
              </p>
              <h1 className="mt-3 font-heading text-4xl font-extrabold tracking-tight">
                Iniciar sesion
              </h1>
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                ${setupInfo?.setupRequired
                  ? "Configura el primer administrador para poner el CRM en marcha."
                  : "Ingresa con una cuenta activa del sistema."}
              </p>
              ${healthInfo?.storage &&
              html`
                <div className=${classNames(
                  "mt-4 rounded-2xl px-4 py-3 text-sm",
                  healthInfo.storage.ready
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                )}>
                  <div className="font-semibold">
                    ${healthInfo.storage.ready
                      ? "Supabase conectado"
                      : "Supabase aun no esta listo"}
                  </div>
                  <div className="mt-1 text-xs">
                    ${healthInfo.storage.ready
                      ? "El CRM esta usando almacenamiento remoto."
                      : healthInfo.storage.lastError || "Revisa la configuracion remota."}
                  </div>
                </div>
              `}
            </div>
            ${setupInfo?.setupRequired
              ? html`
                  <form className="space-y-4" onSubmit=${handleBootstrap}>
                    <${Input} label="Nombre del ministerio" name="churchName" defaultValue="Generacion de Gloria" required />
                    <${Input} label="Nombre del administrador" name="fullName" required />
                    <${Input} label="Correo" name="email" type="email" required />
                    <${Input} label="Contrasena" name="password" type="password" minLength="8" required />
                    ${error &&
                    html`<div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">${error}</div>`}
                    ${notice &&
                    html`<div className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">${notice}</div>`}
                    <button className="w-full rounded-2xl bg-ink px-4 py-3 font-semibold text-white transition hover:translate-y-[-1px] dark:bg-white dark:text-ink" disabled=${loading}>
                      ${loading ? "Creando..." : "Crear administrador inicial"}
                    </button>
                  </form>
                `
              : html`
                  <form className="space-y-4" onSubmit=${handleLogin}>
                    <${Input} label="Correo" name="email" type="email" required />
                    <${Input} label="Contrasena" name="password" type="password" required />
                    ${error &&
                    html`<div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">${error}</div>`}
                    <button className="w-full rounded-2xl bg-ink px-4 py-3 font-semibold text-white transition hover:translate-y-[-1px] dark:bg-white dark:text-ink" disabled=${loading}>
                      ${loading ? "Ingresando..." : "Entrar al CRM"}
                    </button>
                  </form>
                `}
          </div>
        </section>
      </main>
    `;
  }

  return html`
    <div className="min-h-screen p-4 lg:p-6">
      <div className="mx-auto grid max-w-[1600px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="panel rounded-[28px] p-5 shadow-soft">
          <div className="flex items-center gap-4">
            <img src="/assets/brand.svg" alt="Marca" className="h-14 w-14 rounded-2xl" />
            <div>
              <p className="font-heading text-xl font-extrabold">Generacion de Gloria</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">CRM ministerial</p>
            </div>
          </div>
            <div className="mt-8 rounded-3xl bg-ink px-4 py-5 text-white dark:bg-white dark:text-ink">
              <p className="text-sm text-slate-300 dark:text-slate-600">Sesion activa</p>
              <p className="mt-2 font-heading text-xl font-extrabold">${user.fullName}</p>
              <span className=${classNames("mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold", badgeClasses[user.role])}>${user.roleLabel || user.role}</span>
              ${systemInfo?.storage &&
              html`
                <div className="mt-4 rounded-2xl bg-white/10 px-3 py-3 text-xs text-slate-200 dark:bg-slate-900 dark:text-slate-300">
                  <div className="font-semibold uppercase tracking-[0.18em]">
                    Datos ${systemInfo.storage.driver === "supabase" ? "en Supabase" : "en archivo local"}
                  </div>
                  ${systemInfo.storage.intendedDriver === "supabase" &&
                  systemInfo.storage.driver !== "supabase" &&
                  html`<div className="mt-2 text-[11px] text-amber-200 dark:text-amber-300">Supabase esta configurado, pero el sistema esta usando fallback local.</div>`}
                  ${systemInfo.storage.pendingSupabaseConfig &&
                  html`<div className="mt-2 text-[11px] text-amber-200 dark:text-amber-300">Falta completar URL o clave segura de Supabase.</div>`}
                  ${systemInfo.storage.lastError &&
                  html`<div className="mt-2 break-all text-[11px] text-rose-200 dark:text-rose-300">${systemInfo.storage.lastError}</div>`}
                </div>
              `}
            </div>
          <nav className="mt-6 space-y-2">
            ${availableTabs.map(
              (tab) => html`
                <button
                  className=${classNames(
                    "flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-semibold transition",
                    activeTab === tab.key
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  )}
                  onClick=${() => setActiveTab(tab.key)}
                >
                  <span>${tab.label}</span>
                </button>
              `
            )}
          </nav>
          <div className="mt-8 flex gap-3">
            <button
              className="flex-1 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold dark:bg-slate-900"
              onClick=${() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              ${theme === "dark" ? "Modo claro" : "Modo oscuro"}
            </button>
            <button className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white" onClick=${logout}>
              Salir
            </button>
          </div>
        </aside>

        <main className="space-y-4">
          <header className="panel rounded-[28px] px-5 py-4 shadow-soft">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">
                  Ministerio juvenil
                </p>
                <h1 className="mt-2 font-heading text-3xl font-extrabold tracking-tight">
                  ${activeTab === "dashboard" ? "Panel principal" : tabs.find((tab) => tab.key === activeTab)?.label}
                </h1>
              </div>
              ${notice &&
              html`<div className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">${notice}</div>`}
            </div>
            ${error &&
            html`<div className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">${error}</div>`}
          </header>

          ${loading &&
          html`<div className="panel rounded-2xl p-5 text-sm text-slate-500 dark:text-slate-400">Cargando informacion...</div>`}

          ${activeTab === "dashboard" && dashboard && html`
            <section className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <${StatCard} label="Jovenes activos" value=${dashboard.summary.activeYouths} accent="bg-brand-500/20" detail="Base visible segun tu rol" />
                <${StatCard} label="Asistencia semanal" value=${`${dashboard.summary.weeklyAttendance}%`} accent="bg-sky-500/20" detail="Promedio de reuniones de la semana" />
                <${StatCard} label="Alertas pendientes" value=${dashboard.summary.pendingAlerts} accent="bg-amber-500/20" detail="Casos que requieren seguimiento" />
                <${StatCard} label="Seguimientos del mes" value=${dashboard.summary.followUpsThisMonth} accent="bg-emerald-500/20" detail="Interacciones registradas este mes" />
              </div>
              <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
                <${MiniBarChart} items=${dashboard.attendanceTrend} />
                <div className="panel rounded-2xl p-5 shadow-soft">
                  <h3 className="font-heading text-lg font-bold">Alertas visibles</h3>
                  <div className="mt-5 space-y-3">
                    ${dashboard.alerts.length
                      ? dashboard.alerts.map(
                          (alert) => html`
                            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="font-semibold">${alert.youth?.fullName || "Sin nombre"}</p>
                                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">${alert.reason}</p>
                                </div>
                                <span className=${classNames("rounded-full px-3 py-1 text-xs font-bold", badgeClasses[alert.status])}>${alert.status}</span>
                              </div>
                            </div>
                          `
                        )
                      : html`<p className="text-sm text-slate-500 dark:text-slate-400">No hay alertas activas por ahora.</p>`}
                  </div>
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="panel rounded-2xl p-5 shadow-soft">
                  <h3 className="font-heading text-lg font-bold">Actividad reciente</h3>
                  <div className="mt-5 space-y-3">
                    ${dashboard.recentInteractions.length
                      ? dashboard.recentInteractions.map(
                          (item) => html`
                            <div className="rounded-2xl bg-slate-100/90 p-4 dark:bg-slate-900">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-semibold">${item.type}</p>
                                <span className="text-xs text-slate-500">${formatDate(item.date)}</span>
                              </div>
                              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">${item.observations || "Sin observaciones."}</p>
                            </div>
                          `
                        )
                      : html`<p className="text-sm text-slate-500 dark:text-slate-400">Aun no hay seguimientos recientes.</p>`}
                  </div>
                </div>
                <div className="panel rounded-2xl p-5 shadow-soft">
                  <h3 className="font-heading text-lg font-bold">Resumen operativo</h3>
                  <div className="mt-5 space-y-4 text-sm text-slate-600 dark:text-slate-300">
                    <div className="rounded-2xl bg-slate-100/90 p-4 dark:bg-slate-900">
                      Total visibles: <strong>${dashboard.summary.totalYouths}</strong>
                    </div>
                    <div className="rounded-2xl bg-slate-100/90 p-4 dark:bg-slate-900">
                      Asistencia mensual: <strong>${dashboard.summary.monthlyAttendance}%</strong>
                    </div>
                    <div className="rounded-2xl bg-slate-100/90 p-4 dark:bg-slate-900">
                      Base saludable y acompanamiento priorizado en un solo flujo.
                    </div>
                  </div>
                </div>
              </div>
            </section>
          `}

          ${activeTab === "youths" && html`
            <section className="space-y-4">
              <div className="panel rounded-2xl p-4 shadow-soft">
                <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto_auto_auto]">
                  <input
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none dark:border-slate-700 dark:bg-slate-950"
                    placeholder="Buscar por nombre, telefono o direccion"
                    value=${filters.search}
                    onInput=${(event) => setFilters({ ...filters, search: event.target.value })}
                  />
                  <select
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none dark:border-slate-700 dark:bg-slate-950"
                    value=${filters.status}
                    onChange=${(event) => setFilters({ ...filters, status: event.target.value })}
                  >
                    <option value="">Todos los estados</option>
                    <option value="activo">Activos</option>
                    <option value="inactivo">Inactivos</option>
                  </select>
                  ${hasPermission(user, "members:create") && html`
                  <button className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-ink" onClick=${() => { setEditingYouth(null); setShowYouthModal(true); }}>
                    Nuevo joven
                  </button>
                  `}
                  ${hasPermission(user, "reports:export") && html`
                  <button className="rounded-2xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white" onClick=${exportYouths}>
                    Exportar
                  </button>
                  `}
                  ${hasPermission(user, "members:import") &&
                  html`<button className="rounded-2xl bg-slate-200 px-4 py-3 text-sm font-semibold dark:bg-slate-800" onClick=${() => setShowImportModal(true)}>Importar</button>`}
                </div>
              </div>
              ${youths.length
                ? html`
                    <div className="panel scroll-thin overflow-auto rounded-2xl shadow-soft">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-100/90 text-left dark:bg-slate-900">
                          <tr>
                            ${["Nombre", "Cedula", "Celular", "Nacimiento", "Bautizado", "Rol", "Estado", "Acciones"].map(
                              (head) => html`<th className="px-4 py-4 font-semibold">${head}</th>`
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          ${youths.map(
                            (youth) => html`
                              <tr className="border-t border-slate-200/70 dark:border-slate-800">
                                <td className="px-4 py-4">
                                  <div className="font-semibold">${youth.fullName}</div>
                                  <div className="text-xs text-slate-500">${youth.email || "Sin correo"}</div>
                                </td>
                                <td className="px-4 py-4">${youth.documentId || "-"}</td>
                                <td className="px-4 py-4">${youth.phone}</td>
                                <td className="px-4 py-4">${formatDate(youth.birthDate)}</td>
                                <td className="px-4 py-4">${youth.baptized || "-"}</td>
                                <td className="px-4 py-4">
                                  <span className=${classNames("rounded-full px-3 py-1 text-xs font-bold", badgeClasses[youth.memberRole])}>${youth.memberRole || "Miembro"}</span>
                                </td>
                                <td className="px-4 py-4">
                                  <span className=${classNames("rounded-full px-3 py-1 text-xs font-bold", badgeClasses[youth.status])}>${youth.status}</span>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex flex-wrap gap-2">
                                    <button className="rounded-xl bg-slate-200 px-3 py-2 font-semibold dark:bg-slate-800" onClick=${() => openTimeline(youth.id)}>Historial</button>
                                    ${hasPermission(user, "members:update") &&
                                    html`<button className="rounded-xl bg-brand-500 px-3 py-2 font-semibold text-white" onClick=${() => { setEditingYouth(youth); setShowYouthModal(true); }}>Editar</button>`}
                                    ${hasPermission(user, "members:delete") &&
                                    html`<button className="rounded-xl bg-rose-500 px-3 py-2 font-semibold text-white" onClick=${() => removeYouth(youth.id)}>Eliminar</button>`}
                                  </div>
                                </td>
                              </tr>
                            `
                          )}
                        </tbody>
                      </table>
                    </div>
                  `
                : html`<${EmptyState} title="No hay jovenes para mostrar" detail="Prueba creando registros o ajustando los filtros." />`}
            </section>
          `}

          ${activeTab === "attendance" && html`
            <section className="space-y-4">
              ${hasPermission(user, "attendance:create") && html`
              <div className="flex justify-end">
                <button className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-ink" onClick=${() => setShowAttendanceModal(true)}>
                  Nueva asistencia
                </button>
              </div>
              `}
              ${attendance.length
                ? attendance.map(
                    (session) => {
                      const present = session.attendance.filter((item) => item.present).length;
                      const total = session.attendance.length;
                      return html`
                        <div className="panel rounded-2xl p-5 shadow-soft">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <h3 className="font-heading text-lg font-bold">${session.title}</h3>
                              <p className="text-sm text-slate-500 dark:text-slate-400">
                                ${formatDate(session.date)} - ${session.serviceType}
                              </p>
                            </div>
                            <div className="rounded-2xl bg-brand-500/10 px-4 py-3 text-sm font-semibold text-brand-800 dark:text-brand-300">
                              ${present}/${total} presentes
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            ${session.attendance.map(
                              (item) => {
                                const youth = youths.find((row) => row.id === item.youthId);
                                return html`
                                  <div className="rounded-2xl bg-slate-100/90 px-4 py-3 dark:bg-slate-900">
                                    <div className="font-semibold">${youth?.fullName || item.youthId}</div>
                                    <div className=${classNames(
                                      "mt-1 text-xs font-bold",
                                      item.present ? "text-emerald-600" : "text-rose-600"
                                    )}>
                                      ${item.present ? "Asistio" : "Ausente"}
                                    </div>
                                  </div>
                                `;
                              }
                            )}
                          </div>
                        </div>
                      `;
                    }
                  )
                : html`<${EmptyState} title="Sin reuniones registradas" detail="Registra asistencia por servicio o reunion para ver el historial." />`}
            </section>
          `}

          ${activeTab === "interactions" && html`
            <section className="space-y-4">
              ${hasPermission(user, "interactions:create") && html`
              <div className="flex justify-end">
                <button className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-ink" onClick=${() => setShowInteractionModal(true)}>
                  Nuevo seguimiento
                </button>
              </div>
              `}
              ${interactions.length
                ? interactions.map(
                    (item) => html`
                      <div className="panel rounded-2xl p-5 shadow-soft">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex items-center gap-3">
                              <h3 className="font-heading text-lg font-bold">${item.youth?.fullName || "Joven"}</h3>
                              <span className="rounded-full bg-brand-500/10 px-3 py-1 text-xs font-bold text-brand-800 dark:text-brand-300">${item.type}</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">${formatDate(item.date)}</p>
                          </div>
                        </div>
                        <p className="mt-4 text-sm text-slate-700 dark:text-slate-200">${item.observations || "Sin observaciones."}</p>
                        <div className="mt-4 rounded-2xl bg-slate-100/90 p-4 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                          ${item.pastoralNotes || "Sin notas pastorales."}
                        </div>
                      </div>
                    `
                  )
                : html`<${EmptyState} title="Sin seguimientos registrados" detail="Llamadas, visitas y notas pastorales apareceran aqui." />`}
            </section>
          `}

          ${activeTab === "alerts" && html`
            <section className="space-y-4">
              ${alerts.length
                ? alerts.map(
                    (alert) => html`
                      <div className="panel rounded-2xl p-5 shadow-soft">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <div className="flex items-center gap-3">
                              <h3 className="font-heading text-lg font-bold">${alert.youth?.fullName || "Joven"}</h3>
                              <span className=${classNames("rounded-full px-3 py-1 text-xs font-bold", badgeClasses[alert.status])}>${alert.status}</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">${alert.reason}</p>
                          </div>
                          ${alert.status === "pendiente" && hasPermission(user, "alerts:attend") &&
                          html`<button className="rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white" onClick=${() => markAlertAttended(alert.id)}>Marcar atendida</button>`}
                        </div>
                      </div>
                    `
                  )
                : html`<${EmptyState} title="Sin alertas" detail="El sistema mostrara aqui las ausencias consecutivas detectadas." />`}
            </section>
          `}

          ${activeTab === "users" && hasPermission(user, "users:view") && html`
            <section className="space-y-4">
              ${hasPermission(user, "users:manage") && html`
              <div className="flex justify-end">
                <button className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-ink" onClick=${() => { setEditingUser(null); setShowUserModal(true); }}>
                  Nuevo usuario
                </button>
              </div>
              `}
              ${users.length
                ? users.map(
                    (account) => html`
                      <div className="panel rounded-2xl p-5 shadow-soft">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                             <div className="flex items-center gap-3">
                               <h3 className="font-heading text-lg font-bold">${account.fullName}</h3>
                               <span className=${classNames("rounded-full px-3 py-1 text-xs font-bold", badgeClasses[account.role])}>${account.roleLabel || account.role}</span>
                               <span className=${classNames("rounded-full px-3 py-1 text-xs font-bold", badgeClasses[account.active === false ? "inactivo" : "activo"])}>
                                 ${account.active === false ? "inactivo" : "activo"}
                               </span>
                             </div>
                             <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">${account.email}</p>
                           </div>
                           ${hasPermission(user, "users:manage") && html`
                           <div className="flex gap-2">
                             <button className="rounded-2xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white" onClick=${() => { setEditingUser(account); setShowUserModal(true); }}>Editar</button>
                             ${account.id !== user.id &&
                             html`<button className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white" onClick=${() => removeUser(account.id)}>Eliminar</button>`}
                           </div>
                           `}
                        </div>
                      </div>
                    `
                  )
                : html`<${EmptyState} title="Sin usuarios" detail="Los usuarios se sincronizan desde miembros con correo y rol ministerial." />`}
            </section>
          `}
        </main>
      </div>

      <${Modal} open=${showYouthModal} title=${editingYouth ? "Editar joven" : "Nuevo joven"} onClose=${() => { setShowYouthModal(false); setEditingYouth(null); }}>
        <form className="grid gap-4 md:grid-cols-2" onSubmit=${submitYouth}>
          <${Input} label="Nombre completo" name="fullName" defaultValue=${editingYouth?.fullName || ""} required />
          <${Input} label="Cedula" name="documentId" defaultValue=${editingYouth?.documentId || ""} required />
          <${Input} label="Telefono" name="phone" defaultValue=${editingYouth?.phone || ""} required />
          <${Input} label="Correo" name="email" type="email" defaultValue=${editingYouth?.email || ""} />
          <${Input} label="Fecha de nacimiento" name="birthDate" type="date" defaultValue=${editingYouth?.birthDate || ""} required />
          <${Select} label="Bautizado" name="baptized" defaultValue=${editingYouth?.baptized || "NO"}>
            <option value="SI">SI</option>
            <option value="NO">NO</option>
          </${Select}>
          <${Select} label="Rol ministerial" name="memberRole" defaultValue=${editingYouth?.memberRole || "Miembro"}>
            <option value="Administrador">Administrador</option>
            <option value="Pastor">Pastor</option>
            <option value="Lider">Lider</option>
            <option value="Mentor">Mentor</option>
            <option value="Miembro">Miembro</option>
          </${Select}>
          <${Input} label="Direccion" name="address" defaultValue=${editingYouth?.address || ""} />
          <${Select} label="Estado" name="status" defaultValue=${editingYouth?.status || "activo"}>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </${Select}>
          ${hasPermission(user, "members:assign") &&
          html`
            <${Select} label="Asignar mentor" name="assignedUserId" defaultValue=${editingYouth?.assignedUserId || ""}>
              <option value="">Sin asignar</option>
              ${mentorOptions.map((mentor) => html`<option value=${mentor.accountId}>${mentor.fullName}</option>`)}
            </${Select}>
          `}
          <div className="md:col-span-2">
            <${Textarea} label="Notas" name="notes" defaultValue=${editingYouth?.notes || ""} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button className="rounded-2xl bg-brand-600 px-5 py-3 font-semibold text-white">
              ${editingYouth ? "Guardar cambios" : "Registrar joven"}
            </button>
          </div>
        </form>
      </${Modal}>

      <${Modal} open=${showAttendanceModal} title="Registrar asistencia" onClose=${() => setShowAttendanceModal(false)} wide=${true}>
        <form className="space-y-5" onSubmit=${submitAttendance}>
          <div className="grid gap-4 md:grid-cols-3">
            <${Input} label="Titulo" name="title" placeholder="Servicio juvenil" required />
            <${Select} label="Tipo" name="serviceType">
              <option value="servicio">Servicio</option>
              <option value="reunion">Reunion</option>
              <option value="celula">Celula</option>
            </${Select}>
            <${Input} label="Fecha" name="date" type="date" required />
          </div>
          <${Textarea} label="Notas" name="notes" />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            ${youths.map(
              (youth) => html`
                <label className="flex items-center justify-between rounded-2xl bg-slate-100/90 px-4 py-4 dark:bg-slate-900">
                  <div>
                    <div className="font-semibold">${youth.fullName}</div>
                    <div className="text-xs text-slate-500">${youth.phone}</div>
                  </div>
                  <input className="h-5 w-5 accent-[#84974a]" type="checkbox" name=${`attendance_${youth.id}`} defaultChecked=${youth.status === "activo"} />
                </label>
              `
            )}
          </div>
          <div className="flex justify-end">
            <button className="rounded-2xl bg-brand-600 px-5 py-3 font-semibold text-white">Guardar asistencia</button>
          </div>
        </form>
      </${Modal}>

      <${Modal} open=${showInteractionModal} title="Nuevo seguimiento" onClose=${() => setShowInteractionModal(false)}>
        <form className="grid gap-4 md:grid-cols-2" onSubmit=${submitInteraction}>
          <${Select} label="Joven" name="youthId" required>
            <option value="">Selecciona un joven</option>
            ${youths.map((youth) => html`<option value=${youth.id}>${youth.fullName}</option>`)}
          </${Select}>
          <${Select} label="Tipo" name="type" required>
            <option value="llamada">Llamada</option>
            <option value="visita">Visita</option>
          </${Select}>
          <${Input} label="Fecha" name="date" type="date" required />
          <div></div>
          <div className="md:col-span-2">
            <${Textarea} label="Observaciones" name="observations" />
          </div>
          <div className="md:col-span-2">
            <${Textarea} label="Notas pastorales" name="pastoralNotes" />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button className="rounded-2xl bg-brand-600 px-5 py-3 font-semibold text-white">Registrar seguimiento</button>
          </div>
        </form>
      </${Modal}>

      <${Modal} open=${showUserModal} title=${editingUser ? "Editar usuario" : "Crear usuario"} onClose=${() => { setShowUserModal(false); setEditingUser(null); }}>
        <form className="grid gap-4 md:grid-cols-2" onSubmit=${submitUser}>
          <${Input} label="Nombre completo" name="fullName" defaultValue=${editingUser?.fullName || ""} required />
          <${Input} label="Correo" name="email" type="email" defaultValue=${editingUser?.email || ""} required />
          <${Select} label="Rol RBAC manual" name="role" defaultValue=${editingUser?.role || "MIEMBRO"}>
            <option value="MIEMBRO">Miembro</option>
            <option value="MENTOR">Mentor</option>
            <option value="LIDER">Lider</option>
            <option value="PASTOR">Pastor</option>
            <option value="ADMIN">Administrador</option>
          </${Select}>
          <${Input} label="Contrasena" name="password" type="password" defaultValue=${editingUser ? "" : "Cambio123*"} placeholder=${editingUser ? "Dejar vacia para conservar" : ""} />
          <label className="md:col-span-2 flex items-center gap-3 rounded-2xl bg-slate-100/90 px-4 py-4 dark:bg-slate-900">
            <input type="checkbox" name="active" defaultChecked=${editingUser ? editingUser.active !== false : true} className="h-5 w-5 accent-[#84974a]" />
            <span className="text-sm font-medium">Usuario activo</span>
          </label>
          <div className="md:col-span-2">
            <p className="mb-3 text-sm font-medium text-slate-600 dark:text-slate-300">Asignar jovenes</p>
            <div className="grid max-h-64 gap-3 overflow-auto rounded-2xl bg-slate-100/90 p-4 dark:bg-slate-900">
              ${youths.map(
                (youth) => html`
                  <label className="flex items-center gap-3">
                    <input type="checkbox" name="assignedYouthIds" value=${youth.id} defaultChecked=${editingUser?.assignedYouthIds?.includes(youth.id) || false} className="h-5 w-5 accent-[#84974a]" />
                    <span>${youth.fullName}</span>
                  </label>
                `
              )}
            </div>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button className="rounded-2xl bg-brand-600 px-5 py-3 font-semibold text-white">${editingUser ? "Guardar usuario" : "Crear usuario"}</button>
          </div>
        </form>
      </${Modal}>

      <${Modal} open=${showImportModal} title="Importar base de jovenes" onClose=${() => setShowImportModal(false)}>
        <form className="space-y-4" onSubmit=${importWorkbook}>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Importacion directa desde Excel. El CRM buscara la hoja <strong>Base de Datos</strong> y mapeara:
            Nombre, Cedula, Celular, Fecha de Nacimiento, Correo, Bautizados y Rol.
          </p>
          <label className="flex flex-col gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
            <span>Archivo Excel</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"
              onChange=${(event) => setImportFile(event.target.files?.[0] || null)}
            />
          </label>
          ${importFile &&
          html`<div className="rounded-2xl bg-slate-100/90 px-4 py-3 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-300">${importFile.name}</div>`}
          <div className="flex justify-end">
            <button className="rounded-2xl bg-ink px-5 py-3 font-semibold text-white dark:bg-white dark:text-ink" disabled=${loading}>
              ${loading ? "Importando Excel..." : "Importar Excel"}
            </button>
          </div>
        </form>
        <div className="my-6 border-t border-slate-200 dark:border-slate-800"></div>
        <form className="space-y-4" onSubmit=${importCsv}>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Formato CSV con encabezados: nombre_completo, cedula, celular, fecha_de_nacimiento,
            correo, bautizados, rol, estado, notas, correo_mentor_asignado
          </p>
          <${Textarea}
            label="Contenido CSV"
            name="csv"
            defaultValue=${"nombre_completo,cedula,celular,fecha_de_nacimiento,correo,bautizados,rol,estado,notas,correo_mentor_asignado\nAna Torres,1060000001,3000001111,2009-04-20,ana@example.com,SI,Miembro,activo,Se integra al equipo creativo,"}
          />
          <div className="flex justify-end">
            <button className="rounded-2xl bg-brand-600 px-5 py-3 font-semibold text-white">Importar registros</button>
          </div>
        </form>
      </${Modal}>

      <${Modal} open=${Boolean(timeline)} title=${timeline ? `Historial de ${timeline.youth.fullName}` : ""} onClose=${() => setTimeline(null)} wide=${true}>
        ${timeline && html`
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4">
              <div className="rounded-2xl bg-slate-100/90 p-4 dark:bg-slate-900">
                <p className="font-semibold">Datos generales</p>
                <p className="mt-3 text-sm">Cedula: ${timeline.youth.documentId || "-"}</p>
                <p className="mt-1 text-sm">Telefono: ${timeline.youth.phone}</p>
                <p className="mt-1 text-sm">Correo: ${timeline.youth.email || "-"}</p>
                <p className="mt-1 text-sm">Nacimiento: ${formatDate(timeline.youth.birthDate)}</p>
                <p className="mt-1 text-sm">Bautizado: ${timeline.youth.baptized || "-"}</p>
                <p className="mt-1 text-sm">Rol: ${timeline.youth.memberRole || "Miembro"}</p>
              </div>
              <div className="rounded-2xl bg-slate-100/90 p-4 dark:bg-slate-900">
                <p className="font-semibold">Alertas</p>
                <div className="mt-3 space-y-2">
                  ${timeline.alerts.length
                    ? timeline.alerts.map(
                        (alert) => html`<div className="rounded-xl bg-white/80 px-3 py-2 text-sm dark:bg-slate-950">${alert.reason} - ${alert.status}</div>`
                      )
                    : html`<p className="text-sm text-slate-500">Sin alertas registradas.</p>`}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <p className="font-heading text-lg font-bold">Asistencia</p>
              ${timeline.attendanceHistory.length
                ? timeline.attendanceHistory.map(
                    (item) => html`
                      <div className="rounded-2xl bg-slate-100/90 p-4 dark:bg-slate-900">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">${item.title}</span>
                          <span className=${item.record.present ? "text-emerald-600" : "text-rose-600"}>
                            ${item.record.present ? "Asistio" : "Ausente"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">${formatDate(item.date)}</p>
                      </div>
                    `
                  )
                : html`<p className="text-sm text-slate-500">Sin historial de asistencia.</p>`}
            </div>
            <div className="space-y-4">
              <p className="font-heading text-lg font-bold">Seguimientos</p>
              ${timeline.interactions.length
                ? timeline.interactions.map(
                    (item) => html`
                      <div className="rounded-2xl bg-slate-100/90 p-4 dark:bg-slate-900">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">${item.type}</span>
                          <span className="text-sm text-slate-500">${formatDate(item.date)}</span>
                        </div>
                        <p className="mt-2 text-sm">${item.observations || "Sin observaciones."}</p>
                      </div>
                    `
                  )
                : html`<p className="text-sm text-slate-500">Sin seguimientos.</p>`}
            </div>
          </div>
        `}
      </${Modal}>
    </div>
  `;
};

createRoot(document.getElementById("root")).render(html`<${App} />`);
