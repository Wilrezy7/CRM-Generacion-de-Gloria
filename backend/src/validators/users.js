export const isValidEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

export const isStrongEnoughPassword = (value) =>
  String(value || "").length >= 8;
