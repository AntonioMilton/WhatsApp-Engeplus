// Persistência simples das conversas em arquivo JSON (data/conversations.json).
// Para o volume de um suporte interno é suficiente. Em escala maior, trocar por SQLite/Postgres.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const FILE = path.join(DATA_DIR, "conversations.json");

// store: { [phone]: { phone, name, messages:[{dir,text,ts,categoria?}], escalated, updatedAt } }
let store = {};
let saveTimer = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  try {
    store = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    store = {};
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      ensureDir();
      fs.writeFileSync(FILE, JSON.stringify(store));
    } catch (e) {
      console.error("[store] falha ao salvar:", e.message);
    }
  }, 300);
}

load();

function getConv(phone) {
  return (
    store[phone] ||
    (store[phone] = {
      phone,
      name: null,
      messages: [],
      escalated: false,
      updatedAt: 0,
    })
  );
}

// dir: "in" (do cliente) | "out" (do bot)
export function logMessage(phone, dir, text, extra = {}) {
  const c = getConv(phone);
  if (extra.name) c.name = extra.name;
  const msg = { dir, text, ts: Date.now() };
  if (extra.categoria) msg.categoria = extra.categoria;
  c.messages.push(msg);
  if (c.messages.length > 200) c.messages = c.messages.slice(-200);
  c.updatedAt = Date.now();
  save();
}

export function setEscalated(phone, value = true) {
  const c = getConv(phone);
  c.escalated = value;
  c.updatedAt = Date.now();
  save();
}

export function allConversations() {
  return Object.values(store).sort((a, b) => b.updatedAt - a.updatedAt);
}
