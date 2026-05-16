import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18";
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
  { key: "visits", label: "Visitas", permission: "interactions:view" },
  { key: "calls", label: "Llamadas", permission: "interactions:view" },
  { key: "meetings", label: "Reuniones", permission: "interactions:view" },
  { key: "notes", label: "Notas", permission: "interactions:view" },
  { key: "alerts", label: "Alertas", permission: "alerts:view" },
  { key: "reports", label: "Informes", permission: "reports:view" },
  { key: "users", label: "Usuarios", permission: "users:view" },
  { key: "activity", label: "Auditoria", permission: "users:view" }
];

const tokenKey = "gdg_crm_token";
const themeKey = "gdg_crm_theme";
const logoSrc = "/assets/logo-generacion-gloria.png";
const allowedSystemRoles = ["ADMIN", "PASTOR", "LIDER", "MENTOR", "SECRETARIA"];

const navSections = [
  {
    title: "General",
    items: [
      { key: "dashboard", label: "Dashboard", icon: "layout-dashboard", permission: "dashboard:view" },
      { key: "home", target: "dashboard", label: "Inicio", icon: "home", permission: "dashboard:view" }
    ]
  },
  {
    title: "Gestion",
    items: [
      { key: "youths", label: "Miembros", icon: "users-round", permission: "members:view" },
      { key: "attendance", label: "Asistencia", icon: "calendar-check", permission: "attendance:view" },
      { key: "interactions", label: "Seguimientos", icon: "message-square-heart", permission: "interactions:view" },
      { key: "visits", label: "Mentorias", icon: "hand-heart", permission: "interactions:view" },
      { key: "alerts", label: "Alertas", icon: "bell-ring", permission: "alerts:view" }
    ]
  },
  {
    title: "Pastoral",
    items: [
      { key: "visits", label: "Visitas", icon: "map-pin", permission: "interactions:view" },
      { key: "calls", label: "Llamadas", icon: "phone-call", permission: "interactions:view" },
      { key: "meetings", label: "Reuniones", icon: "calendar-days", permission: "interactions:view" },
      { key: "notes", label: "Notas", icon: "notebook-pen", permission: "interactions:view" }
    ]
  },
  {
    title: "Administracion",
    items: [
      { key: "users", label: "Usuarios", icon: "user-cog", permission: "users:view" },
      { key: "users", label: "Roles", icon: "shield-check", permission: "users:view" },
      { key: "users", label: "Permisos", icon: "key-round", permission: "users:view" }
    ]
  },
  {
    title: "Reportes",
    items: [
      { key: "reports", label: "Informes", icon: "file-bar-chart", permission: "reports:view" },
      { key: "reports", label: "Estadisticas", icon: "chart-no-axes-combined", permission: "reports:view" },
      { key: "reports", label: "Exportaciones", icon: "download", permission: "reports:export" }
    ]
  },
  {
    title: "Configuracion",
    items: [
      { key: "activity", label: "Ajustes", icon: "settings", permission: "users:view" },
      { key: "dashboard", label: "Perfil", icon: "circle-user-round", permission: "dashboard:view" },
      { key: "dashboard", label: "Seguridad", icon: "lock-keyhole", permission: "dashboard:view" }
    ]
  }
];

const classNames = (...values) => values.filter(Boolean).join(" ");

const hasPermission = (user, permission) =>
  Boolean(user?.permissions?.includes(permission));

const Icon = ({ name, className = "h-5 w-5" }) =>
  html`<i data-lucide=${name} className=${className}></i>`;

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
    mentor: "Mentor",
    secretaria: "Secretaria",
    secretario: "Secretaria",
    visitante: "Visitante",
    nuevo: "Nuevo",
    nueva: "Nuevo",
    congregante: "Congregante"
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
  SECRETARIA: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  MIEMBRO: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  Administrador: "bg-brand-500/15 text-brand-800 dark:text-brand-300",
  Pastor: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  Miembro: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  Visitante: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  Nuevo: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  Congregante: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  Lider: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Mentor: "bg-sky-500/15 text-sky-700 dark:text-sky-300"
};

const StatCard = ({ label, value, accent, detail, icon = "activity" }) => html`
  <div className="panel fade-in group rounded-[22px] p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-xl">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">${label}</p>
        <h3 className="mt-2 font-heading text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white">${value}</h3>
      </div>
      <div className=${classNames("flex h-12 w-12 items-center justify-center rounded-2xl text-slate-900 ring-1 ring-black/5 dark:text-white", accent)}>
        <${Icon} name=${icon} className="h-5 w-5" />
      </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className=${classNames("panel fade-in max-h-[90vh] overflow-auto rounded-[28px] shadow-2xl", wide ? "w-full max-w-5xl" : "w-full max-w-2xl")}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200/70 bg-white/90 px-6 py-4 backdrop-blur dark:border-slate-800 dark:bg-night/90">
          <h3 className="font-heading text-xl font-bold">${title}</h3>
          <button className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white transition hover:scale-105 dark:bg-white dark:text-slate-900" onClick=${onClose} aria-label="Cerrar">
            <${Icon} name="x" className="h-5 w-5" />
          </button>
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
  <div className="panel rounded-[24px] p-10 text-center shadow-soft">
    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-700 dark:text-brand-300">
      <${Icon} name="inbox" />
    </div>
    <h3 className="font-heading text-lg font-bold">${title}</h3>
    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">${detail}</p>
  </div>
`;

const MentorshipList = ({ items, emptyTitle, emptyDetail, renderDetail }) => html`
  <section className="space-y-4">
    ${items.length
      ? items.map(
          (item) => html`
            <div className="panel rounded-2xl p-5 shadow-soft">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="font-heading text-lg font-bold">${item.youth?.fullName || "Miembro"}</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">${formatDate(item.date || item.createdAt)}</p>
                </div>
                ${item.mentor && html`<span className="rounded-full bg-sky-500/15 px-3 py-1 text-xs font-bold text-sky-700 dark:text-sky-300">${item.mentor.fullName}</span>`}
              </div>
              <div className="mt-4 text-sm text-slate-700 dark:text-slate-200">${renderDetail(item)}</div>
            </div>
          `
        )
      : html`<${EmptyState} title=${emptyTitle} detail=${emptyDetail} />`}
  </section>
`;

const ChartPanel = ({ title, labels, values }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !window.Chart) return undefined;
    const chart = new window.Chart(ref.current, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: title,
            data: values,
            backgroundColor: "#84974a",
            borderRadius: 8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
    return () => chart.destroy();
  }, [title, labels.join("|"), values.join("|")]);
  return html`
    <div className="panel rounded-2xl p-5 shadow-soft">
      <h3 className="font-heading text-lg font-bold">${title}</h3>
      <div className="mt-4 h-72">
        <canvas ref=${ref}></canvas>
      </div>
    </div>
  `;
};

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
  const [visits, setVisits] = useState([]);
  const [calls, setCalls] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [pastoralNotes, setPastoralNotes] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [users, setUsers] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [reports, setReports] = useState([]);
  const [reportPreview, setReportPreview] = useState(null);
  const [reportFilters, setReportFilters] = useState({
    type: "general",
    from: "",
    to: "",
    mentorId: "",
    status: "",
    baptized: "",
    minAge: "",
    maxAge: ""
  });
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    window.lucide?.createIcons();
  }, [activeTab, user, loading, sidebarCollapsed, mobileMenuOpen, notice, error]);

  const availableTabs = useMemo(
    () => tabs.filter((tab) => hasPermission(user, tab.permission)),
    [user]
  );

  const visibleNavSections = useMemo(
    () =>
      navSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => hasPermission(user, item.permission))
        }))
        .filter((section) => section.items.length),
    [user]
  );

  const currentTab = tabs.find((tab) => tab.key === activeTab) || tabs[0];

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

  const loadMentorship = async (authToken = token, currentUser = user) => {
    if (!hasPermission(currentUser, "interactions:view")) return;
    const [nextVisits, nextCalls, nextMeetings, nextNotes] = await Promise.all([
      request("/visits", { token: authToken }),
      request("/calls", { token: authToken }),
      request("/meetings", { token: authToken }),
      request("/pastoral-notes", { token: authToken })
    ]);
    setVisits(nextVisits);
    setCalls(nextCalls);
    setMeetings(nextMeetings);
    setPastoralNotes(nextNotes);
  };

  const loadAlerts = async (authToken = token) => {
    setAlerts(await request("/alerts", { token: authToken }));
  };

  const loadUsers = async (authToken = token) => {
    if (hasPermission(user, "users:view")) {
      const accounts = await request("/users", { token: authToken });
      setUsers(accounts.filter((account) => allowedSystemRoles.includes(account.role)));
    }
  };

  const loadActivityLogs = async (authToken = token, currentUser = user) => {
    if (hasPermission(currentUser, "users:view")) {
      setActivityLogs(await request("/activity-logs", { token: authToken }));
    }
  };

  const loadReports = async (authToken = token, currentUser = user) => {
    if (hasPermission(currentUser, "reports:view")) {
      setReports(await request("/reports", { token: authToken }));
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
        loadMentorship(authToken, me.user),
        loadAlerts(authToken),
        loadReports(authToken, me.user)
      ]);
      if (hasPermission(me.user, "users:view")) {
        const accounts = await request("/users", { token: authToken });
        setUsers(accounts.filter((account) => allowedSystemRoles.includes(account.role)));
        setActivityLogs(await request("/activity-logs", { token: authToken }));
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
      loadMentorship(),
      loadAlerts(),
      hasPermission(user, "reports:view") ? loadReports() : Promise.resolve(),
      hasPermission(user, "users:view") ? loadUsers() : Promise.resolve(),
      hasPermission(user, "users:view") ? loadActivityLogs() : Promise.resolve()
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

  const resetPassword = async (id) => {
    try {
      const result = await request(`/users/${id}/reset-password`, { method: "POST", token });
      window.alert(`Contrasena temporal: ${result.temporaryPassword}`);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const submitReport = async (event) => {
    event.preventDefault();
    try {
      const data = await request("/reports", {
        method: "POST",
        token,
        body: {
          type: reportFilters.type,
          filters: reportFilters
        }
      });
      setReportPreview(data);
      await loadReports();
      showMessage("Informe generado.");
    } catch (err) {
      setError(err.message);
    }
  };

  const downloadReport = async (format) => {
    try {
      const params = new URLSearchParams(reportFilters).toString();
      const response = await request(`/reports/export/${format}?${params}`, {
        token,
        raw: true
      });
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename=([^;]+)/)?.[1] || `informe.${format === "excel" ? "xls" : "pdf"}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      await loadReports();
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
      <main className="grid min-h-screen bg-slate-50 dark:bg-night lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden bg-ink lg:block">
          <img src=${logoSrc} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.34),transparent_30%),linear-gradient(135deg,_rgba(8,17,31,0.92),_rgba(15,23,42,0.84))]"></div>
          <div className="relative flex h-full flex-col justify-between p-12 text-white">
            <div className="flex items-center gap-4">
              <img src=${logoSrc} alt="Generacion de Gloria" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/20" />
              <div>
                <p className="font-heading text-2xl font-extrabold">Generacion de Gloria</p>
                <p className="text-sm text-slate-300">CRM institucional pastoral</p>
              </div>
            </div>
            <div className="max-w-xl">
              <p className="font-heading text-5xl font-extrabold leading-tight tracking-tight">
                Gestion pastoral moderna para equipos que cuidan personas.
              </p>
              <p className="mt-6 text-lg text-slate-300">
                Un espacio limpio para coordinar miembros, mentorias, asistencia, alertas e informes con una experiencia de CRM profesional.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              ${[
                ["Multiusuario", "Roles y permisos reales"],
                ["Mentorias", "Seguimiento pastoral trazable"],
                ["Informes", "PDF y Excel institucional"]
              ].map(
                ([title, text]) => html`
                  <div className="rounded-[24px] border border-white/10 bg-white/10 p-4 backdrop-blur">
                    <p className="font-semibold">${title}</p>
                    <p className="mt-2 text-sm text-slate-300">${text}</p>
                  </div>
                `
              )}
            </div>
          </div>
        </section>
        <section className="flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md panel rounded-[32px] p-8 shadow-soft">
            <div className="mb-8">
              <img src=${logoSrc} alt="Generacion de Gloria" className="mb-6 h-20 w-20 rounded-3xl object-cover shadow-soft lg:hidden" />
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
    <div className="app-shell min-h-screen">
      ${mobileMenuOpen && html`<div className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-sm lg:hidden" onClick=${() => setMobileMenuOpen(false)}></div>`}
      <aside className=${classNames(
        "sidebar-shell fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200/70 bg-white/92 shadow-2xl backdrop-blur-xl dark:border-slate-800 dark:bg-night/92",
        sidebarCollapsed ? "lg:w-[92px]" : "lg:w-[292px]",
        mobileMenuOpen ? "w-[292px] translate-x-0" : "w-[292px] -translate-x-full lg:translate-x-0"
      )}>
        <div className="flex h-20 items-center gap-3 border-b border-slate-200/70 px-4 dark:border-slate-800">
          <img src=${logoSrc} alt="Generacion de Gloria" className="h-12 w-12 rounded-2xl object-cover shadow-soft" />
          ${!sidebarCollapsed && html`
            <div className="min-w-0">
              <p className="truncate font-heading text-lg font-extrabold">Generacion de Gloria</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">CRM institucional</p>
            </div>
          `}
          <button className="ml-auto hidden h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 transition hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 lg:flex" onClick=${() => setSidebarCollapsed(!sidebarCollapsed)} aria-label="Colapsar menu">
            <${Icon} name=${sidebarCollapsed ? "panel-left-open" : "panel-left-close"} />
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-3 py-4">
          ${visibleNavSections.map((section) => html`
            <div className="mb-5">
              ${!sidebarCollapsed && html`<p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">${section.title}</p>`}
              <div className="space-y-1">
                ${section.items.map((item) => html`
                  <button
                    className=${classNames(
                      "nav-item flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold",
                      activeTab === item.key
                        ? "bg-brand-600 text-white shadow-lg shadow-brand-900/10"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white",
                      sidebarCollapsed && "justify-center"
                    )}
                    title=${item.label}
                    onClick=${() => { setActiveTab(item.target || item.key); setMobileMenuOpen(false); }}
                  >
                    <${Icon} name=${item.icon} className="h-5 w-5 shrink-0" />
                    ${!sidebarCollapsed && html`<span className="truncate">${item.label}</span>`}
                  </button>
                `)}
              </div>
            </div>
          `)}
        </div>

        <div className="border-t border-slate-200/70 p-3 dark:border-slate-800">
          <div className=${classNames("rounded-[22px] bg-slate-950 p-3 text-white dark:bg-white dark:text-slate-950", sidebarCollapsed && "px-2")}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500 text-white">
                <${Icon} name="user-round" />
              </div>
              ${!sidebarCollapsed && html`
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">${user.fullName}</p>
                  <p className="truncate text-xs opacity-70">${user.roleLabel || user.role}</p>
                </div>
              `}
            </div>
          </div>
          <div className=${classNames("mt-3 flex gap-2", sidebarCollapsed && "flex-col")}>
            <button className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-100 text-sm font-semibold transition hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800" onClick=${() => setTheme(theme === "dark" ? "light" : "dark")} title="Cambiar tema">
              <${Icon} name=${theme === "dark" ? "sun" : "moon"} />
              ${!sidebarCollapsed && html`<span>${theme === "dark" ? "Claro" : "Oscuro"}</span>`}
            </button>
            <button className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-rose-500 px-3 text-sm font-semibold text-white transition hover:bg-rose-600" onClick=${logout} title="Salir">
              <${Icon} name="log-out" />
              ${!sidebarCollapsed && html`<span>Salir</span>`}
            </button>
          </div>
        </div>
      </aside>

      <div className=${classNames("min-h-screen p-4 transition-[padding] duration-200 lg:p-6", sidebarCollapsed ? "lg:pl-[116px]" : "lg:pl-[316px]")}>
        <main className="mx-auto max-w-[1600px] space-y-4">
          <header className="panel rounded-[28px] px-5 py-4 shadow-soft">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <button className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 transition hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 lg:hidden" onClick=${() => setMobileMenuOpen(true)} aria-label="Abrir menu">
                  <${Icon} name="menu" />
                </button>
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">
                    Ministerio juvenil
                  </p>
                  <h1 className="mt-2 font-heading text-3xl font-extrabold tracking-tight">
                    ${activeTab === "dashboard" ? "Panel principal" : currentTab?.label}
                  </h1>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                ${systemInfo?.storage &&
                html`<span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 dark:bg-slate-900 dark:text-slate-300">${systemInfo.storage.driver === "supabase" ? "Supabase" : "Local"}</span>`}
                ${notice &&
                html`<div className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">${notice}</div>`}
              </div>
            </div>
            ${error &&
            html`<div className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">${error}</div>`}
          </header>

          ${loading &&
          html`
            <div className="grid gap-4 md:grid-cols-3">
              ${[1, 2, 3].map(() => html`<div className="panel skeleton h-28 rounded-[22px] p-5 shadow-soft"></div>`)}
            </div>
          `}

          ${activeTab === "dashboard" && dashboard && html`
            <section className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <${StatCard} label="Miembros activos" value=${dashboard.summary.activeYouths} accent="bg-brand-500/15" icon="users-round" detail="Base visible segun tu rol" />
                <${StatCard} label="Asistencia semanal" value=${`${dashboard.summary.weeklyAttendance}%`} accent="bg-sky-500/15" icon="calendar-check" detail="Promedio semanal" />
                <${StatCard} label="Mentorias activas" value=${dashboard.summary.assignedMembers || 0} accent="bg-emerald-500/15" icon="hand-heart" detail="Miembros asignados" />
                <${StatCard} label="Seguimientos pendientes" value=${dashboard.summary.followUpsThisMonth} accent="bg-violet-500/15" icon="message-square-heart" detail="Registros del mes" />
                <${StatCard} label="Alertas" value=${dashboard.summary.pendingAlerts} accent="bg-amber-500/15" icon="bell-ring" detail="Casos por atender" />
                <${StatCard} label="Lideres activos" value=${dashboard.summary.activeMentors || 0} accent="bg-fuchsia-500/15" icon="shield-check" detail="Equipo con acceso" />
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
                    <div className="panel scroll-thin overflow-auto rounded-[24px] shadow-soft">
                      <table className="data-table min-w-full text-sm">
                        <thead className="sticky top-0 bg-slate-100/95 text-left backdrop-blur dark:bg-slate-900/95">
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

          ${activeTab === "visits" && html`
            <${MentorshipList}
              items=${visits}
              emptyTitle="Sin visitas registradas"
              emptyDetail="Las visitas pastorales y de mentoría aparecerán aquí."
              renderDetail=${(item) => html`
                <p>${item.observations || "Sin observaciones."}</p>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Ubicacion: ${item.location || "-"}</p>
                <p className="mt-1 text-slate-500 dark:text-slate-400">Resultado: ${item.result || "-"}</p>
              `}
            />
          `}

          ${activeTab === "calls" && html`
            <${MentorshipList}
              items=${calls}
              emptyTitle="Sin llamadas registradas"
              emptyDetail="Las llamadas de seguimiento aparecerán aquí."
              renderDetail=${(item) => html`
                <p>${item.observations || "Sin observaciones."}</p>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Duracion: ${item.durationMinutes || 0} minutos</p>
              `}
            />
          `}

          ${activeTab === "meetings" && html`
            <${MentorshipList}
              items=${meetings}
              emptyTitle="Sin reuniones registradas"
              emptyDetail="Las reuniones de mentoría aparecerán aquí."
              renderDetail=${(item) => html`
                <p>${item.notes || "Sin notas."}</p>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Tipo: ${item.type || "mentoria"}</p>
              `}
            />
          `}

          ${activeTab === "notes" && html`
            <section className="space-y-4">
              ${pastoralNotes.length
                ? pastoralNotes.map((item) => html`
                  <div className="panel rounded-2xl p-5 shadow-soft">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="font-heading text-lg font-bold">${item.youth?.fullName || "Miembro"}</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">${formatDate(item.createdAt)}</p>
                      </div>
                      <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-300">${item.private ? "Privada" : "Compartida"}</span>
                    </div>
                    <p className="mt-4 text-sm text-slate-700 dark:text-slate-200">${item.note}</p>
                  </div>
                `)
                : html`<${EmptyState} title="Sin notas pastorales" detail="Las notas privadas autorizadas aparecerán aquí." />`}
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

          ${activeTab === "reports" && hasPermission(user, "reports:view") && html`
            <section className="space-y-6">
              <div className="panel rounded-2xl p-5 shadow-soft">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="font-heading text-2xl font-extrabold">Informes institucionales</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Reportes ejecutivos con filtros, estadísticas y descargas trazables.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white" onClick=${() => downloadReport("excel")}>Descargar Excel</button>
                    <button className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white" onClick=${() => downloadReport("pdf")}>Descargar PDF</button>
                  </div>
                </div>
                <form className="mt-6 grid gap-4 md:grid-cols-4" onSubmit=${submitReport}>
                  <${Select} label="Tipo de informe" value=${reportFilters.type} onChange=${(event) => setReportFilters({ ...reportFilters, type: event.target.value })}>
                    <option value="general">General de miembros</option>
                    <option value="follow_up">Seguimientos</option>
                  </${Select}>
                  <${Input} label="Desde" type="date" value=${reportFilters.from} onChange=${(event) => setReportFilters({ ...reportFilters, from: event.target.value })} />
                  <${Input} label="Hasta" type="date" value=${reportFilters.to} onChange=${(event) => setReportFilters({ ...reportFilters, to: event.target.value })} />
                  <${Select} label="Mentor/Lider/Pastor" value=${reportFilters.mentorId} onChange=${(event) => setReportFilters({ ...reportFilters, mentorId: event.target.value })}>
                    <option value="">Todos</option>
                    ${mentorOptions.map((mentor) => html`<option value=${mentor.accountId}>${mentor.fullName}</option>`)}
                  </${Select}>
                  <${Select} label="Estado" value=${reportFilters.status} onChange=${(event) => setReportFilters({ ...reportFilters, status: event.target.value })}>
                    <option value="">Todos</option>
                    <option value="activo">Activos</option>
                    <option value="inactivo">Inactivos</option>
                  </${Select}>
                  <${Select} label="Bautizados" value=${reportFilters.baptized} onChange=${(event) => setReportFilters({ ...reportFilters, baptized: event.target.value })}>
                    <option value="">Todos</option>
                    <option value="SI">SI</option>
                    <option value="NO">NO</option>
                  </${Select}>
                  <${Input} label="Edad minima" type="number" value=${reportFilters.minAge} onChange=${(event) => setReportFilters({ ...reportFilters, minAge: event.target.value })} />
                  <${Input} label="Edad maxima" type="number" value=${reportFilters.maxAge} onChange=${(event) => setReportFilters({ ...reportFilters, maxAge: event.target.value })} />
                  <div className="md:col-span-4 flex justify-end">
                    <button className="rounded-2xl bg-brand-600 px-5 py-3 font-semibold text-white" disabled=${loading}>Generar informe</button>
                  </div>
                </form>
              </div>

              ${reportPreview && html`
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <${StatCard} label="Miembros" value=${reportPreview.summary.totalMembers} accent="bg-brand-500" detail="Total filtrado" />
                  <${StatCard} label="Activos" value=${reportPreview.summary.activeMembers} accent="bg-emerald-500" detail="Miembros activos" />
                  <${StatCard} label="Seguimientos" value=${reportPreview.summary.visits + reportPreview.summary.calls + reportPreview.summary.meetings + reportPreview.summary.interactions} accent="bg-sky-500" detail="Visitas, llamadas y reuniones" />
                  <${StatCard} label="Alertas" value=${reportPreview.summary.activeAlerts} accent="bg-amber-500" detail="Alertas activas" />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <${ChartPanel}
                    title="Distribucion por roles"
                    labels=${Object.keys(reportPreview.distributions.roles)}
                    values=${Object.values(reportPreview.distributions.roles)}
                  />
                  <${ChartPanel}
                    title="Distribucion por edades"
                    labels=${Object.keys(reportPreview.distributions.ages)}
                    values=${Object.values(reportPreview.distributions.ages)}
                  />
                </div>
                <div className="panel rounded-2xl p-5 shadow-soft">
                  <h3 className="font-heading text-lg font-bold">Resumen ejecutivo</h3>
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                    El informe registra ${reportPreview.summary.totalMembers} miembros, ${reportPreview.summary.baptizedMembers} bautizados,
                    ${reportPreview.summary.membersWithoutFollowUp} sin seguimiento reciente y una efectividad de mentorías de
                    ${reportPreview.summary.mentorshipEffectiveness}%.
                  </p>
                </div>
              `}

              <div className="panel rounded-2xl p-5 shadow-soft">
                <h3 className="font-heading text-lg font-bold">Informes recientes</h3>
                <div className="mt-4 space-y-3">
                  ${reports.length
                    ? reports.map((report) => html`
                      <div className="flex flex-col gap-2 rounded-2xl bg-slate-100/90 px-4 py-3 dark:bg-slate-900 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-semibold">${report.type}</div>
                          <div className="text-sm text-slate-500">${formatDate(report.createdAt?.slice(0, 10))} · ${report.generatedByUser?.fullName || "Sistema"}</div>
                        </div>
                        <div className="text-sm text-slate-500">${report.summary?.totalMembers || 0} miembros</div>
                      </div>
                    `)
                    : html`<p className="text-sm text-slate-500 dark:text-slate-400">Aun no hay informes generados.</p>`}
                </div>
              </div>
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
                             <button className="rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white" onClick=${() => resetPassword(account.id)}>Reset</button>
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

          ${activeTab === "activity" && hasPermission(user, "users:view") && html`
            <section className="space-y-4">
              ${activityLogs.length
                ? activityLogs.map((log) => html`
                  <div className="panel rounded-2xl p-5 shadow-soft">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="font-heading text-lg font-bold">${log.action}</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">${log.user?.fullName || "Sistema"} · ${log.entityType || "-"}</p>
                      </div>
                      <span className="text-sm text-slate-500 dark:text-slate-400">${formatDate(log.createdAt?.slice(0, 10))}</span>
                    </div>
                  </div>
                `)
                : html`<${EmptyState} title="Sin auditoría" detail="La actividad de usuarios aparecerá aquí." />`}
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
            <option value="Secretaria">Secretaria</option>
            <option value="Miembro">Miembro</option>
            <option value="Visitante">Visitante</option>
            <option value="Nuevo">Nuevo</option>
            <option value="Congregante">Congregante</option>
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
          <${Select} label="Rol RBAC manual" name="role" defaultValue=${editingUser?.role || "MENTOR"}>
            <option value="MENTOR">Mentor</option>
            <option value="LIDER">Lider</option>
            <option value="PASTOR">Pastor</option>
            <option value="SECRETARIA">Secretaria</option>
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
