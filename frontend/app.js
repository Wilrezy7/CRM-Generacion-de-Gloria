import React, { useEffect, useMemo, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import htm from "https://esm.sh/htm@3";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const html = htm.bind(React.createElement);
const apiBase = window.GDG_API_BASE || "/api";

const tabs = [
  { key: "dashboard", label: "Dashboard", roles: ["ADMIN", "PASTOR", "SECRETARIA", "LIDER", "MENTOR"] },
  { key: "youths", label: "Miembros", roles: ["ADMIN", "PASTOR", "SECRETARIA", "LIDER", "MENTOR"] },
  { key: "attendance", label: "Asistencia", roles: ["ADMIN", "PASTOR", "SECRETARIA", "LIDER"] },
  { key: "interactions", label: "Seguimiento", roles: ["ADMIN", "PASTOR", "LIDER", "MENTOR"] },
  { key: "alerts", label: "Alertas", roles: ["ADMIN", "PASTOR", "SECRETARIA", "LIDER", "MENTOR"] },
  { key: "reports", label: "Informes", roles: ["ADMIN", "PASTOR", "SECRETARIA"] },
  { key: "users", label: "Usuarios", roles: ["ADMIN"] }
];

const tokenKey = "gdg_crm_token";
const refreshTokenKey = "gdg_crm_refresh";
const themeKey = "gdg_crm_theme";

const classNames = (...values) => values.filter(Boolean).join(" ");

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
    miembro: "Miembro",
    lider: "Lider",
    co_lider: "Lider",
    colider: "Lider",
    mentor: "Mentor",
    diacono: "Diacono"
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

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const toIsoDate = (value) => String(value || "").slice(0, 10);

const inDateRange = (value, from, to) => {
  const date = toIsoDate(value);
  if (!date) return true;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
};

const percent = (value, total) => (total ? Math.round((value / total) * 100) : 0);

const reportPalette = ["#0f172a", "#2563eb", "#14b8a6", "#f59e0b", "#ef4444", "#7c3aed", "#64748b"];

const buildBarChartSvg = (items, { width = 760, height = 260, title = "" } = {}) => {
  const data = items.length ? items : [{ label: "Sin datos", value: 0 }];
  const max = Math.max(...data.map((item) => Number(item.value) || 0), 1);
  const chartTop = 42;
  const chartBottom = 52;
  const chartLeft = 56;
  const chartRight = 24;
  const chartHeight = height - chartTop - chartBottom;
  const barGap = 14;
  const barWidth = Math.max(24, (width - chartLeft - chartRight - barGap * (data.length - 1)) / data.length);
  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
      <rect width="${width}" height="${height}" rx="24" fill="#ffffff"/>
      <text x="24" y="28" fill="#0f172a" font-size="18" font-weight="800">${escapeHtml(title)}</text>
      <line x1="${chartLeft}" y1="${chartTop + chartHeight}" x2="${width - chartRight}" y2="${chartTop + chartHeight}" stroke="#cbd5e1" stroke-width="1"/>
      ${[0.25, 0.5, 0.75, 1].map((tick) => {
        const y = chartTop + chartHeight - chartHeight * tick;
        return `<line x1="${chartLeft}" y1="${y}" x2="${width - chartRight}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/><text x="12" y="${y + 4}" fill="#64748b" font-size="11">${Math.round(max * tick)}</text>`;
      }).join("")}
      ${data.map((item, index) => {
        const value = Number(item.value) || 0;
        const barHeight = value ? Math.max(8, (value / max) * chartHeight) : 4;
        const x = chartLeft + index * (barWidth + barGap);
        const y = chartTop + chartHeight - barHeight;
        const color = reportPalette[(index + 1) % reportPalette.length];
        const label = String(item.label || "").slice(0, 13);
        return `
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="10" fill="${color}"/>
          <text x="${x + barWidth / 2}" y="${Math.max(chartTop + 14, y - 8)}" fill="#0f172a" font-size="12" font-weight="800" text-anchor="middle">${value}</text>
          <text x="${x + barWidth / 2}" y="${height - 24}" fill="#334155" font-size="11" font-weight="700" text-anchor="middle">${escapeHtml(label)}</text>
        `;
      }).join("")}
    </svg>
  `;
};

const buildDonutChartSvg = (items, { size = 280, title = "" } = {}) => {
  const total = items.reduce((acc, item) => acc + (Number(item.value) || 0), 0);
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const safeItems = items.length ? items : [{ label: "Sin datos", value: 1 }];
  const segments = safeItems.map((item, index) => {
    const value = Number(item.value) || 0;
    const ratio = total ? value / total : 1 / safeItems.length;
    const dash = ratio * circumference;
    const segment = `<circle cx="110" cy="126" r="${radius}" fill="none" stroke="${reportPalette[(index + 1) % reportPalette.length]}" stroke-width="26" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" stroke-linecap="round" transform="rotate(-90 110 126)"/>`;
    offset += dash;
    return segment;
  }).join("");
  return `
    <svg class="chart-svg" viewBox="0 0 ${size + 240} ${size}" role="img" aria-label="${escapeHtml(title)}">
      <rect width="${size + 240}" height="${size}" rx="24" fill="#ffffff"/>
      <text x="24" y="32" fill="#0f172a" font-size="18" font-weight="800">${escapeHtml(title)}</text>
      <circle cx="110" cy="126" r="${radius}" fill="none" stroke="#e2e8f0" stroke-width="26"/>
      ${segments}
      <text x="110" y="119" fill="#0f172a" font-size="28" font-weight="900" text-anchor="middle">${total}</text>
      <text x="110" y="142" fill="#64748b" font-size="12" font-weight="700" text-anchor="middle">registros</text>
      ${safeItems.map((item, index) => {
        const y = 72 + index * 34;
        const value = Number(item.value) || 0;
        return `
          <rect x="235" y="${y - 13}" width="14" height="14" rx="4" fill="${reportPalette[(index + 1) % reportPalette.length]}"/>
          <text x="260" y="${y}" fill="#334155" font-size="13" font-weight="700">${escapeHtml(item.label)}</text>
          <text x="${size + 210}" y="${y}" fill="#0f172a" font-size="13" font-weight="900" text-anchor="end">${value} (${percent(value, total)}%)</text>
        `;
      }).join("")}
    </svg>
  `;
};

const badgeClasses = {
  activo: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  inactivo: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  pendiente: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  atendida: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  ADMIN: "bg-brand-500/15 text-brand-800 dark:text-brand-300",
  PASTOR: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  SECRETARIA: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
  LIDER: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  MENTOR: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  Miembro: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  Lider: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Mentor: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Diacono: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
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
  const [authMode, setAuthMode] = useState(
    new URLSearchParams(window.location.search).get("resetToken") ? "reset" : "login"
  );
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [reportFilters, setReportFilters] = useState({
    from: "",
    to: "",
    status: "",
    memberRole: "",
    assignedUserId: ""
  });
  const [showYouthModal, setShowYouthModal] = useState(false);
  const [editingYouth, setEditingYouth] = useState(null);
  const [showInteractionModal, setShowInteractionModal] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);

  const availableTabs = useMemo(
    () => tabs.filter((tab) => user && tab.roles.includes(user.role)),
    [user]
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
    if (user?.role === "ADMIN") {
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
      if (me.user.role === "ADMIN") {
        setUsers(await request("/users", { token: authToken }));
      }
      setError("");
    } catch (err) {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(refreshTokenKey);
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
      user?.role === "ADMIN" ? loadUsers() : Promise.resolve()
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
      const accessToken = data.accessToken || data.token;
      localStorage.setItem(tokenKey, accessToken);
      if (data.refreshToken) {
        localStorage.setItem(refreshTokenKey, data.refreshToken);
      }
      setToken(accessToken);
      setUser(data.user);
      await bootstrap(accessToken);
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

  const handleForgotPassword = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      await request("/auth/forgot-password", {
        method: "POST",
        body: { email: form.get("email") }
      });
      setError("");
      showMessage("Si el correo existe, recibira instrucciones para recuperar el acceso.");
      setAuthMode("login");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      setError("Las contrasenas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      await request("/auth/reset-password", {
        method: "POST",
        body: {
          token: new URLSearchParams(window.location.search).get("resetToken"),
          password
        }
      });
      window.history.replaceState({}, document.title, window.location.pathname);
      setAuthMode("login");
      setError("");
      showMessage("Contrasena actualizada. Ya puedes iniciar sesion.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      setError("Las contrasenas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      await request("/auth/change-password", {
        method: "POST",
        token,
        body: {
          currentPassword: form.get("currentPassword"),
          newPassword
        }
      });
      setUser({ ...user, mustChangePassword: false });
      setError("");
      showMessage("Contrasena actualizada correctamente.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem(refreshTokenKey) || "";
    try {
      if (token) {
        await request("/auth/logout", {
          method: "POST",
          token,
          body: { refreshToken }
        });
      }
    } catch {}
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(refreshTokenKey);
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

  const openGeneralReport = async () => {
    setLoading(true);
    try {
      const [allYouths, allAttendance, allInteractions, allAlerts] = await Promise.all([
        request("/youths?", { token }),
        request("/attendance", { token }),
        request("/interactions", { token }),
        request("/alerts", { token })
      ]);
      const filteredYouths = allYouths.filter((item) => {
        if (reportFilters.status && item.status !== reportFilters.status) return false;
        if (reportFilters.memberRole && item.memberRole !== reportFilters.memberRole) return false;
        if (reportFilters.assignedUserId && item.assignedUserId !== reportFilters.assignedUserId) return false;
        return true;
      });
      const visibleIds = new Set(filteredYouths.map((item) => item.id));
      const filteredAttendance = allAttendance
        .filter((session) => inDateRange(session.date, reportFilters.from, reportFilters.to))
        .map((session) => ({
          ...session,
          attendance: session.attendance.filter((item) => visibleIds.has(item.youthId))
        }))
        .filter((session) => session.attendance.length);
      const filteredInteractions = allInteractions.filter(
        (item) =>
          visibleIds.has(item.youthId) && inDateRange(item.date, reportFilters.from, reportFilters.to)
      );
      const filteredAlerts = allAlerts.filter(
        (item) =>
          visibleIds.has(item.youthId) &&
          inDateRange(item.generatedAt || item.date, reportFilters.from, reportFilters.to)
      );
      const present = filteredAttendance.reduce(
        (acc, session) => acc + session.attendance.filter((item) => item.present).length,
        0
      );
      const attendanceTotal = filteredAttendance.reduce(
        (acc, session) => acc + session.attendance.length,
        0
      );
      const roleCounts = filteredYouths.reduce((acc, item) => {
        const key = item.memberRole || "Sin rol";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const interactionCounts = filteredInteractions.reduce((acc, item) => {
        const key = item.type || "otro";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const reportDate = new Date().toLocaleDateString("es-CO", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
      const periodText =
        reportFilters.from || reportFilters.to
          ? `${reportFilters.from || "inicio"} a ${reportFilters.to || "actualidad"}`
          : "Todos los registros visibles";
      const activeCount = filteredYouths.filter((item) => item.status === "activo").length;
      const inactiveCount = filteredYouths.filter((item) => item.status === "inactivo").length;
      const pendingAlerts = filteredAlerts.filter((item) => item.status === "pendiente").length;
      const attendanceRate = percent(present, attendanceTotal);
      const followedYouthIds = new Set(filteredInteractions.map((item) => item.youthId));
      const followUpCoverage = percent(followedYouthIds.size, filteredYouths.length);
      const generatedAt = new Date();
      const generatedDateTime = generatedAt.toLocaleString("es-CO", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
      const rows = (items, render) => items.map(render).join("");
      const kpiCards = [
        { label: "Miembros incluidos", value: filteredYouths.length, detail: `${activeCount} activos`, tone: "blue", icon: "M" },
        { label: "Asistencia promedio", value: `${attendanceRate}%`, detail: `${present}/${attendanceTotal} registros`, tone: attendanceRate >= 70 ? "green" : "amber", icon: "%" },
        { label: "Seguimientos", value: filteredInteractions.length, detail: `${followUpCoverage}% cobertura`, tone: "teal", icon: "S" },
        { label: "Alertas pendientes", value: pendingAlerts, detail: `${filteredAlerts.length} alertas totales`, tone: pendingAlerts ? "red" : "green", icon: "A" }
      ];
      const roleChart = buildDonutChartSvg(
        Object.entries(roleCounts).map(([label, value]) => ({ label, value })),
        { title: "Distribucion por rol ministerial" }
      );
      const attendanceChart = buildBarChartSvg(
        filteredAttendance.slice(-10).map((session) => {
          const sessionPresent = session.attendance.filter((item) => item.present).length;
          return { label: formatDate(session.date), value: percent(sessionPresent, session.attendance.length) };
        }),
        { title: "Asistencia por reunion (%)" }
      );
      const interactionChart = buildBarChartSvg(
        Object.entries(interactionCounts).map(([label, value]) => ({ label, value })),
        { title: "Seguimientos por tipo" }
      );
      const alertChart = buildDonutChartSvg(
        [
          { label: "Pendientes", value: pendingAlerts },
          { label: "Atendidas", value: filteredAlerts.filter((item) => item.status === "atendida").length }
        ],
        { title: "Estado de alertas" }
      );
      const reportHtml = `<!doctype html>
        <html lang="es">
          <head>
            <meta charset="utf-8" />
            <title>Informe general - Generacion de Gloria</title>
            <style>
              @page {
                size: letter;
                margin: 1.45cm;
                @bottom-center {
                  content: "Generacion de Gloria CRM - Pagina " counter(page) " de " counter(pages);
                  color: #64748b;
                  font-family: Inter, Arial, sans-serif;
                  font-size: 8.5pt;
                }
              }
              * { box-sizing: border-box; }
              body {
                background: #eef2f7;
                color: #0f172a;
                font-family: Inter, Roboto, "Open Sans", Arial, sans-serif;
                font-size: 10.5pt;
                line-height: 1.55;
                margin: 0;
              }
              .controls {
                align-items: center;
                background: #0f172a;
                color: white;
                display: flex;
                gap: 10px;
                justify-content: flex-end;
                padding: 12px 18px;
                position: sticky;
                top: 0;
                z-index: 20;
              }
              .controls button {
                border: 0;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 800;
                padding: 10px 16px;
              }
              .primary { background: #f59e0b; color: #111827; }
              .secondary { background: #ffffff; color: #111827; }
              .page {
                background: #ffffff;
                border-radius: 8px;
                box-shadow: 0 16px 46px rgba(15, 23, 42, .12);
                margin: 24px auto;
                max-width: 980px;
                overflow: hidden;
              }
              .cover {
                background:
                  linear-gradient(135deg, rgba(15, 23, 42, .94), rgba(30, 41, 59, .88)),
                  radial-gradient(circle at 18% 10%, rgba(245, 158, 11, .35), transparent 32%);
                color: white;
                min-height: 720px;
                padding: 54px;
                position: relative;
              }
              .cover::after {
                background: #f59e0b;
                bottom: 0;
                content: "";
                height: 10px;
                left: 0;
                position: absolute;
                right: 0;
              }
              .cover-header, .report-header {
                align-items: center;
                display: flex;
                gap: 18px;
                justify-content: space-between;
              }
              .brand {
                align-items: center;
                display: flex;
                gap: 14px;
              }
              .brand img {
                border-radius: 8px;
                height: 74px;
                object-fit: cover;
                width: 74px;
              }
              .brand-name { font-size: 18pt; font-weight: 900; margin: 0; }
              .brand-subtitle { color: #cbd5e1; font-size: 9.5pt; margin: 2px 0 0; }
              .cover-title {
                margin-top: 130px;
                max-width: 720px;
              }
              h1 {
                font-size: 34pt;
                line-height: 1.05;
                margin: 0;
              }
              .cover-lead {
                color: #e2e8f0;
                font-size: 13pt;
                margin: 20px 0 0;
                max-width: 680px;
              }
              .cover-meta {
                background: rgba(255, 255, 255, .1);
                border: 1px solid rgba(255, 255, 255, .18);
                border-radius: 8px;
                display: grid;
                gap: 10px;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                margin-top: 58px;
                padding: 18px;
              }
              .meta-label { color: #cbd5e1; display: block; font-size: 8pt; font-weight: 800; margin-bottom: 2px; text-transform: uppercase; }
              .meta-value { color: white; font-weight: 800; }
              .content { padding: 30px 34px 34px; }
              .report-header {
                border-bottom: 1px solid #e2e8f0;
                margin-bottom: 22px;
                padding-bottom: 16px;
              }
              .report-logo { border-radius: 8px; height: 52px; object-fit: cover; width: 52px; }
              .report-title { font-size: 17pt; font-weight: 900; margin: 0; }
              .report-caption { color: #64748b; font-size: 9pt; margin: 2px 0 0; }
              h2 {
                color: #0f172a;
                font-size: 16pt;
                line-height: 1.2;
                margin: 28px 0 10px;
              }
              h3 {
                color: #0f172a;
                font-size: 12pt;
                margin: 18px 0 8px;
              }
              p { color: #334155; margin: 0 0 12px; }
              .kpi-grid {
                display: grid;
                gap: 14px;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                margin: 18px 0 22px;
              }
              .kpi {
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                box-shadow: 0 10px 28px rgba(15, 23, 42, .08);
                min-height: 118px;
                overflow: hidden;
                padding: 14px;
                position: relative;
              }
              .kpi::before { content: ""; height: 5px; left: 0; position: absolute; right: 0; top: 0; }
              .kpi.blue::before { background: #2563eb; }
              .kpi.green::before { background: #22c55e; }
              .kpi.amber::before { background: #f59e0b; }
              .kpi.red::before { background: #ef4444; }
              .kpi.teal::before { background: #14b8a6; }
              .kpi-top { align-items: center; display: flex; justify-content: space-between; }
              .kpi-icon {
                align-items: center;
                background: #f1f5f9;
                border-radius: 8px;
                color: #0f172a;
                display: flex;
                font-size: 10pt;
                font-weight: 900;
                height: 34px;
                justify-content: center;
                width: 34px;
              }
              .kpi-label { color: #64748b; font-size: 8.5pt; font-weight: 800; margin: 0; text-transform: uppercase; }
              .kpi-value { color: #0f172a; font-size: 24pt; font-weight: 900; line-height: 1; margin: 14px 0 6px; }
              .kpi-detail { color: #64748b; font-size: 9pt; margin: 0; }
              .chart-grid {
                display: grid;
                gap: 16px;
                grid-template-columns: 1fr 1fr;
                margin: 18px 0 22px;
              }
              .chart-panel {
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 10px;
                page-break-inside: avoid;
              }
              .chart-panel.wide { grid-column: 1 / -1; }
              .chart-svg { display: block; height: auto; width: 100%; }
              table {
                border-collapse: separate;
                border-spacing: 0;
                font-size: 9.4pt;
                margin: 12px 0 22px;
                overflow: hidden;
                page-break-inside: auto;
                width: 100%;
              }
              caption {
                caption-side: top;
                color: #0f172a;
                font-size: 10pt;
                font-weight: 900;
                margin-bottom: 8px;
                text-align: left;
              }
              thead { display: table-header-group; }
              tr { page-break-inside: avoid; }
              th {
                background: #0f172a;
                color: white;
                font-size: 8.5pt;
                padding: 10px;
                text-align: left;
              }
              td {
                border-bottom: 1px solid #e2e8f0;
                color: #334155;
                padding: 9px 10px;
                vertical-align: top;
              }
              tbody tr:nth-child(even) td { background: #f8fafc; }
              tfoot td {
                background: #eff6ff;
                color: #0f172a;
                font-weight: 900;
              }
              .status {
                border-radius: 999px;
                display: inline-block;
                font-size: 8pt;
                font-weight: 900;
                padding: 4px 8px;
              }
              .status.good { background: #dcfce7; color: #166534; }
              .status.warn { background: #fef3c7; color: #92400e; }
              .status.bad { background: #fee2e2; color: #991b1b; }
              .executive-box {
                background: linear-gradient(135deg, #eff6ff, #f8fafc);
                border: 1px solid #bfdbfe;
                border-radius: 8px;
                margin: 14px 0 20px;
                padding: 16px;
              }
              .note { color: #64748b; font-size: 8.8pt; margin-top: -12px; }
              .references p { padding-left: 22px; text-indent: -22px; }
              .footer {
                border-top: 1px solid #e2e8f0;
                color: #64748b;
                display: flex;
                font-size: 8.5pt;
                justify-content: space-between;
                margin-top: 28px;
                padding-top: 12px;
              }
              .page-break { page-break-before: always; }
              @media print {
                body { background: white; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
                .controls { display: none; }
                .page { box-shadow: none; margin: 0; max-width: none; overflow: visible; }
                .cover { border-radius: 0; min-height: 91vh; }
                .chart-panel, .kpi, table { page-break-inside: avoid; }
              }
            </style>
          </head>
          <body>
            <div class="controls">
              <button class="secondary" onclick="window.close()">Cerrar</button>
              <button class="primary" onclick="window.print()">Generar PDF</button>
            </div>
            <section class="page cover">
              <div class="cover-header">
                <div class="brand">
                  <img src="${window.location.origin}/assets/logo-generacion-gloria.png" alt="Generacion de Gloria" />
                  <div>
                    <p class="brand-name">Generacion de Gloria CRM</p>
                    <p class="brand-subtitle">Sistema institucional de seguimiento ministerial</p>
                  </div>
                </div>
                <div>
                  <span class="status ${pendingAlerts ? "warn" : "good"}">${pendingAlerts ? "Requiere seguimiento" : "Estado estable"}</span>
                </div>
              </div>
              <div class="cover-title">
                <h1>Informe ejecutivo general</h1>
                <p class="cover-lead">Analisis operativo de miembros, asistencia, seguimiento pastoral y alertas con filtros institucionales y visualizacion ejecutiva.</p>
              </div>
              <div class="cover-meta">
                <div><span class="meta-label">Generado por</span><span class="meta-value">${escapeHtml(user.fullName)}</span></div>
                <div><span class="meta-label">Rol</span><span class="meta-value">${escapeHtml(user.role)}</span></div>
                <div><span class="meta-label">Fecha y hora</span><span class="meta-value">${escapeHtml(generatedDateTime)}</span></div>
                <div><span class="meta-label">Periodo</span><span class="meta-value">${escapeHtml(periodText)}</span></div>
              </div>
            </section>
            <main class="page content">
              <header class="report-header">
                <div class="brand">
                  <img class="report-logo" src="${window.location.origin}/assets/logo-generacion-gloria.png" alt="Generacion de Gloria" />
                  <div>
                    <p class="report-title">Informe general institucional</p>
                    <p class="report-caption">Generado el ${escapeHtml(generatedDateTime)} por ${escapeHtml(user.fullName)}</p>
                  </div>
                </div>
                <span class="status good">Supabase</span>
              </header>
              <h2>Resumen ejecutivo</h2>
              <div class="executive-box">
                <p>El periodo analizado incluye ${filteredYouths.length} miembros visibles, ${filteredAttendance.length} sesiones de asistencia, ${filteredInteractions.length} seguimientos y ${filteredAlerts.length} alertas. La asistencia promedio se ubica en ${attendanceRate}% y la cobertura de seguimiento en ${followUpCoverage}% de los miembros filtrados.</p>
              </div>
              <section class="kpi-grid">
                ${kpiCards.map((card) => `
                  <article class="kpi ${card.tone}">
                    <div class="kpi-top">
                      <p class="kpi-label">${escapeHtml(card.label)}</p>
                      <div class="kpi-icon">${escapeHtml(card.icon)}</div>
                    </div>
                    <p class="kpi-value">${escapeHtml(card.value)}</p>
                    <p class="kpi-detail">${escapeHtml(card.detail)}</p>
                  </article>
                `).join("")}
              </section>
              <h2>Visualizacion estadistica</h2>
              <section class="chart-grid">
                <div class="chart-panel">${roleChart}</div>
                <div class="chart-panel">${alertChart}</div>
                <div class="chart-panel wide">${attendanceChart}</div>
                <div class="chart-panel wide">${interactionChart}</div>
              </section>
              <h2 class="page-break">Resultados detallados</h2>
              <table>
                <caption>Tabla 1<br />Indicadores generales del periodo</caption>
                <thead><tr><th>Indicador</th><th>Resultado</th></tr></thead>
                <tbody>
                  <tr><td>Miembros visibles incluidos</td><td>${filteredYouths.length}</td></tr>
                  <tr><td>Miembros activos</td><td>${activeCount}</td></tr>
                  <tr><td>Miembros inactivos</td><td>${inactiveCount}</td></tr>
                  <tr><td>Sesiones de asistencia</td><td>${filteredAttendance.length}</td></tr>
                  <tr><td>Promedio de asistencia</td><td>${attendanceRate}%</td></tr>
                  <tr><td>Seguimientos registrados</td><td>${filteredInteractions.length}</td></tr>
                  <tr><td>Cobertura de seguimiento</td><td>${followUpCoverage}%</td></tr>
                  <tr><td>Alertas pendientes</td><td>${pendingAlerts}</td></tr>
                </tbody>
              </table>
              <p class="note"><em>Nota.</em> Los indicadores se calculan con base en los filtros seleccionados y permisos del rol autenticado.</p>
              <table>
                <caption>Tabla 2<br />Distribucion de miembros por rol ministerial</caption>
                <thead><tr><th>Rol ministerial</th><th>Cantidad</th><th>Porcentaje</th></tr></thead>
                <tbody>
                  ${rows(Object.entries(roleCounts), ([role, count]) => `<tr><td>${escapeHtml(role)}</td><td>${count}</td><td>${percent(count, filteredYouths.length)}%</td></tr>`) || `<tr><td colspan="3">No hay miembros para los filtros seleccionados.</td></tr>`}
                </tbody>
                <tfoot><tr><td>Total</td><td>${filteredYouths.length}</td><td>100%</td></tr></tfoot>
              </table>
              <table>
                <caption>Tabla 3<br />Asistencia por reunion o servicio</caption>
                <thead><tr><th>Fecha</th><th>Actividad</th><th>Presentes</th><th>Total</th><th>Asistencia</th></tr></thead>
                <tbody>
                  ${rows(filteredAttendance, (session) => {
                    const sessionPresent = session.attendance.filter((item) => item.present).length;
                    return `<tr><td>${escapeHtml(formatDate(session.date))}</td><td>${escapeHtml(session.title)}</td><td>${sessionPresent}</td><td>${session.attendance.length}</td><td>${percent(sessionPresent, session.attendance.length)}%</td></tr>`;
                  }) || `<tr><td colspan="5">No hay sesiones de asistencia en el periodo seleccionado.</td></tr>`}
                </tbody>
                <tfoot><tr><td colspan="2">Total / promedio</td><td>${present}</td><td>${attendanceTotal}</td><td>${attendanceRate}%</td></tr></tfoot>
              </table>
              <table>
                <caption>Tabla 4<br />Seguimientos por tipo</caption>
                <thead><tr><th>Tipo</th><th>Cantidad</th></tr></thead>
                <tbody>
                  ${rows(Object.entries(interactionCounts), ([type, count]) => `<tr><td>${escapeHtml(type)}</td><td>${count}</td></tr>`) || `<tr><td colspan="2">No hay seguimientos en el periodo seleccionado.</td></tr>`}
                </tbody>
                <tfoot><tr><td>Total</td><td>${filteredInteractions.length}</td></tr></tfoot>
              </table>
              <h2>Metodo e interpretacion</h2>
              <p>Los datos fueron extraidos del CRM Generacion de Gloria al momento de generar el informe. Se aplicaron los filtros definidos por el usuario y las restricciones de acceso por rol. Las estadisticas descriptivas se calcularon sobre registros visibles y disponibles en Supabase.</p>
              <p>Los indicadores deben interpretarse como insumos para priorizar acompanamiento, fortalecer la asistencia y distribuir responsabilidades de seguimiento. Una asistencia baja o alertas pendientes sugieren la necesidad de contacto pastoral oportuno, visitas, llamadas o reuniones de cuidado segun el rol responsable.</p>
              <h2>Referencias</h2>
              <div class="references">
                <p>American Psychological Association. (2020). <em>Publication manual of the American Psychological Association</em> (7th ed.). American Psychological Association.</p>
                <p>Generacion de Gloria. (${new Date().getFullYear()}). <em>CRM institucional de seguimiento ministerial</em> [Base de datos interna].</p>
              </div>
              <footer class="footer">
                <span>Generacion de Gloria CRM</span>
                <span>${escapeHtml(generatedDateTime)}</span>
                <span>Informe institucional</span>
              </footer>
            </main>
          </body>
        </html>`;
      const reportWindow = window.open("", "_blank");
      if (!reportWindow) {
        throw new Error("El navegador bloqueo la ventana del informe. Permite ventanas emergentes para generar PDF.");
      }
      reportWindow.document.open();
      reportWindow.document.write(reportHtml);
      reportWindow.document.close();
      reportWindow.focus();
      showMessage("Informe generado. Usa el boton Generar PDF en la nueva ventana.");
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
              <img src="/assets/logo-generacion-gloria.png" alt="Generacion de Gloria" className="h-24 w-24 rounded-2xl object-cover shadow-soft" />
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
                ["Roles seguros", "Admin y asistentes con permisos claros"],
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
              : authMode === "forgot"
              ? html`
                  <form className="space-y-4" onSubmit=${handleForgotPassword}>
                    <${Input} label="Correo registrado" name="email" type="email" required />
                    ${error &&
                    html`<div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">${error}</div>`}
                    ${notice &&
                    html`<div className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">${notice}</div>`}
                    <button className="w-full rounded-2xl bg-ink px-4 py-3 font-semibold text-white transition hover:translate-y-[-1px] dark:bg-white dark:text-ink" disabled=${loading}>
                      ${loading ? "Enviando..." : "Enviar recuperacion"}
                    </button>
                    <button type="button" className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900" onClick=${() => { setError(""); setAuthMode("login"); }}>
                      Volver al inicio de sesion
                    </button>
                  </form>
                `
              : authMode === "reset"
              ? html`
                  <form className="space-y-4" onSubmit=${handleResetPassword}>
                    <${Input} label="Nueva contrasena" name="password" type="password" minLength="8" required />
                    <${Input} label="Confirmar contrasena" name="confirmPassword" type="password" minLength="8" required />
                    ${error &&
                    html`<div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">${error}</div>`}
                    ${notice &&
                    html`<div className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">${notice}</div>`}
                    <button className="w-full rounded-2xl bg-ink px-4 py-3 font-semibold text-white transition hover:translate-y-[-1px] dark:bg-white dark:text-ink" disabled=${loading}>
                      ${loading ? "Actualizando..." : "Cambiar contrasena"}
                    </button>
                    <button type="button" className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900" onClick=${() => { setError(""); setAuthMode("login"); }}>
                      Volver al inicio de sesion
                    </button>
                  </form>
                `
              : html`
                  <form className="space-y-4" onSubmit=${handleLogin}>
                    <${Input} label="Correo" name="email" type="email" required />
                    <${Input} label="Contrasena" name="password" type="password" required />
                    ${error &&
                    html`<div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">${error}</div>`}
                    ${notice &&
                    html`<div className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">${notice}</div>`}
                    <button className="w-full rounded-2xl bg-ink px-4 py-3 font-semibold text-white transition hover:translate-y-[-1px] dark:bg-white dark:text-ink" disabled=${loading}>
                      ${loading ? "Ingresando..." : "Entrar al CRM"}
                    </button>
                    <button type="button" className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900" onClick=${() => { setError(""); setAuthMode("forgot"); }}>
                      Olvide mi contrasena
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
            <img src="/assets/logo-generacion-gloria.png" alt="Marca Generacion de Gloria" className="h-20 w-20 rounded-2xl object-cover shadow-soft" />
            <div>
              <p className="font-heading text-xl font-extrabold">Generacion de Gloria</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">CRM ministerial</p>
            </div>
          </div>
            <div className="mt-8 rounded-3xl bg-ink px-4 py-5 text-white dark:bg-white dark:text-ink">
              <p className="text-sm text-slate-300 dark:text-slate-600">Sesion activa</p>
              <p className="mt-2 font-heading text-xl font-extrabold">${user.fullName}</p>
              <span className=${classNames("mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold", badgeClasses[user.role])}>${user.role}</span>
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
                  <button className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-ink" onClick=${() => { setEditingYouth(null); setShowYouthModal(true); }}>
                    Nuevo joven
                  </button>
                  <button className="rounded-2xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white" onClick=${exportYouths}>
                    Exportar
                  </button>
                  ${user.role === "ADMIN" &&
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
                                    <button className="rounded-xl bg-brand-500 px-3 py-2 font-semibold text-white" onClick=${() => { setEditingYouth(youth); setShowYouthModal(true); }}>Editar</button>
                                    ${user.role === "ADMIN" &&
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
              <div className="flex justify-end">
                <button className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-ink" onClick=${() => setShowAttendanceModal(true)}>
                  Nueva asistencia
                </button>
              </div>
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
              <div className="flex justify-end">
                <button className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-ink" onClick=${() => setShowInteractionModal(true)}>
                  Nuevo seguimiento
                </button>
              </div>
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
                          ${alert.status === "pendiente" &&
                          html`<button className="rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white" onClick=${() => markAlertAttended(alert.id)}>Marcar atendida</button>`}
                        </div>
                      </div>
                    `
                  )
                : html`<${EmptyState} title="Sin alertas" detail="El sistema mostrara aqui las ausencias consecutivas detectadas." />`}
            </section>
          `}

          ${activeTab === "reports" && html`
            <section className="space-y-4">
              <div className="panel rounded-2xl p-5 shadow-soft">
                <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-end">
                  <div>
                    <h2 className="font-heading text-xl font-extrabold">Informe general institucional</h2>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      Genera un documento profesional con estadisticas, tablas APA y filtros por periodo, estado, rol ministerial y responsable.
                    </p>
                  </div>
                  <button className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-ink" onClick=${openGeneralReport} disabled=${loading}>
                    ${loading ? "Generando..." : "Generar PDF"}
                  </button>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <${Input}
                    label="Desde"
                    type="date"
                    value=${reportFilters.from}
                    onChange=${(event) => setReportFilters({ ...reportFilters, from: event.target.value })}
                  />
                  <${Input}
                    label="Hasta"
                    type="date"
                    value=${reportFilters.to}
                    onChange=${(event) => setReportFilters({ ...reportFilters, to: event.target.value })}
                  />
                  <${Select}
                    label="Estado"
                    value=${reportFilters.status}
                    onChange=${(event) => setReportFilters({ ...reportFilters, status: event.target.value })}
                  >
                    <option value="">Todos</option>
                    <option value="activo">Activos</option>
                    <option value="inactivo">Inactivos</option>
                  </${Select}>
                  <${Select}
                    label="Rol ministerial"
                    value=${reportFilters.memberRole}
                    onChange=${(event) => setReportFilters({ ...reportFilters, memberRole: event.target.value })}
                  >
                    <option value="">Todos</option>
                    <option value="Miembro">Miembro</option>
                    <option value="Lider">Lider</option>
                    <option value="Mentor">Mentor</option>
                    <option value="Pastor">Pastor</option>
                    <option value="Secretaria">Secretaria</option>
                    <option value="Admin">Admin</option>
                    <option value="Diacono">Diacono</option>
                  </${Select}>
                  <${Select}
                    label="Responsable"
                    value=${reportFilters.assignedUserId}
                    onChange=${(event) => setReportFilters({ ...reportFilters, assignedUserId: event.target.value })}
                  >
                    <option value="">Todos</option>
                    ${users.map((item) => html`<option value=${item.id}>${item.fullName}</option>`)}
                  </${Select}>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="panel rounded-2xl p-5 shadow-soft">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Formato</p>
                  <p className="mt-2 font-heading text-2xl font-extrabold">APA 7</p>
                </div>
                <div className="panel rounded-2xl p-5 shadow-soft">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Salida</p>
                  <p className="mt-2 font-heading text-2xl font-extrabold">PDF</p>
                </div>
                <div className="panel rounded-2xl p-5 shadow-soft">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Fuente</p>
                  <p className="mt-2 font-heading text-2xl font-extrabold">Supabase</p>
                </div>
              </div>
              <div className="panel rounded-2xl p-5 text-sm text-slate-600 shadow-soft dark:text-slate-300">
                El informe se abre en una ventana nueva con boton de impresion. En el dialogo del navegador selecciona "Guardar como PDF".
              </div>
            </section>
          `}

          ${activeTab === "users" && user.role === "ADMIN" && html`
            <section className="space-y-4">
              <div className="flex justify-end">
                <button className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-ink" onClick=${() => { setEditingUser(null); setShowUserModal(true); }}>
                  Nuevo usuario
                </button>
              </div>
              ${users.length
                ? users.map(
                    (account) => html`
                      <div className="panel rounded-2xl p-5 shadow-soft">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                             <div className="flex items-center gap-3">
                               <h3 className="font-heading text-lg font-bold">${account.fullName}</h3>
                               <span className=${classNames("rounded-full px-3 py-1 text-xs font-bold", badgeClasses[account.role])}>${account.role}</span>
                               <span className=${classNames("rounded-full px-3 py-1 text-xs font-bold", badgeClasses[account.active === false ? "inactivo" : "activo"])}>
                                 ${account.active === false ? "inactivo" : "activo"}
                               </span>
                             </div>
                             <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">${account.email}</p>
                           </div>
                           <div className="flex gap-2">
                             <button className="rounded-2xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white" onClick=${() => { setEditingUser(account); setShowUserModal(true); }}>Editar</button>
                             ${account.id !== user.id &&
                             html`<button className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white" onClick=${() => removeUser(account.id)}>Eliminar</button>`}
                           </div>
                        </div>
                      </div>
                    `
                  )
                : html`<${EmptyState} title="Sin usuarios" detail="Crea asistentes y asigna jovenes desde este modulo." />`}
            </section>
          `}
        </main>
      </div>

      ${user.mustChangePassword &&
      html`
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="panel w-full max-w-md rounded-[28px] p-8 shadow-soft">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-300">
              Seguridad de cuenta
            </p>
            <h2 className="mt-3 font-heading text-3xl font-extrabold">Cambia tu contrasena</h2>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              El administrador asigno una contrasena temporal. Define una nueva para continuar.
            </p>
            <form className="mt-6 space-y-4" onSubmit=${handleChangePassword}>
              <${Input} label="Contrasena temporal" name="currentPassword" type="password" required />
              <${Input} label="Nueva contrasena" name="newPassword" type="password" minLength="8" required />
              <${Input} label="Confirmar contrasena" name="confirmPassword" type="password" minLength="8" required />
              ${error &&
              html`<div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">${error}</div>`}
              <button className="w-full rounded-2xl bg-ink px-4 py-3 font-semibold text-white dark:bg-white dark:text-ink" disabled=${loading}>
                ${loading ? "Actualizando..." : "Guardar contrasena"}
              </button>
            </form>
          </div>
        </div>
      `}

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
            <option value="Miembro">Miembro</option>
            <option value="Lider">Lider</option>
            <option value="Mentor">Mentor</option>
            <option value="Diacono">Diacono</option>
          </${Select}>
          <${Input} label="Direccion" name="address" defaultValue=${editingYouth?.address || ""} />
          <${Select} label="Estado" name="status" defaultValue=${editingYouth?.status || "activo"}>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </${Select}>
          ${user.role === "ADMIN" &&
          html`
            <${Select} label="Asignar a" name="assignedUserId" defaultValue=${editingYouth?.assignedUserId || ""}>
              <option value="">Sin asignar</option>
              ${users
                .filter((item) => ["SECRETARIA", "LIDER", "MENTOR"].includes(item.role))
                .map((item) => html`<option value=${item.id}>${item.fullName}</option>`)}
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
          <${Select} label="Rol" name="role" defaultValue=${editingUser?.role || "MENTOR"}>
            <option value="ADMIN">Admin</option>
            <option value="PASTOR">Pastor</option>
            <option value="SECRETARIA">Secretaria</option>
            <option value="LIDER">Lider</option>
            <option value="MENTOR">Mentor</option>
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
            correo, bautizados, rol, estado, notas, correo_asistente_asignado
          </p>
          <${Textarea}
            label="Contenido CSV"
            name="csv"
            defaultValue=${"nombre_completo,cedula,celular,fecha_de_nacimiento,correo,bautizados,rol,estado,notas,correo_asistente_asignado\nAna Torres,1060000001,3000001111,2009-04-20,ana@example.com,SI,Miembro,activo,Se integra al equipo creativo,"}
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
