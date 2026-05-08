export const createId = (prefix) =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

export const nowIso = () => new Date().toISOString();

export const normalizeText = (value) => String(value || "").trim();

export const sortByDateDesc = (items, field) =>
  [...items].sort((a, b) => String(b[field]).localeCompare(String(a[field])));

export const sameMonth = (isoDate, compareDate) =>
  isoDate.slice(0, 7) === compareDate.toISOString().slice(0, 7);

export const sameWeek = (isoDate, compareDate) => {
  const value = new Date(`${isoDate}T00:00:00`);
  const start = new Date(compareDate);
  start.setDate(compareDate.getDate() - compareDate.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return value >= start && value < end;
};
