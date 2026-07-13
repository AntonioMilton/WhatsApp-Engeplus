// Persistência simples em arquivo JSON (data/store.json).
// Guarda: conversas (painel), fluxo do atendimento, tickets ativos/histórico,
// alertas para o operador e notificações pendentes (fora da janela de 24h).
// Para o volume de um suporte interno é suficiente. Em escala maior, trocar por SQLite/Postgres.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const FILE = path.join(DATA_DIR, "store.json");
const LEGACY_FILE = path.join(DATA_DIR, "conversations.json");

// Formato:
// {
//   conversations: { [phone]: { phone, name, messages:[{dir,text,ts,categoria?}], escalated,
//                               flow: { phase, dados }, updatedAt } },
//   tickets:       { [phone]: { phone, key, id, url, status, phase, lastCommentId,
//                               pendingTech, dados, createdAt, updatedAt } },
//   ticketHistory: [ ...tickets encerrados... ],
//   alerts:        [ { ts, phone, name, ticket, message, reason } ],
//   pending:       { [phone]: [ "mensagem a entregar quando o usuário escrever" ] }
// }
let store = { conversations: {}, tickets: {}, ticketHistory: [], alerts: [], pending: {} };
let saveTimer = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    store = {
      conversations: raw.conversations || {},
      tickets: raw.tickets || {},
      ticketHistory: raw.ticketHistory || [],
      alerts: raw.alerts || [],
      pending: raw.pending || {},
    };
  } catch {
    // Migração do formato antigo (data/conversations.json: mapa por telefone)
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8"));
      store.conversations = legacy || {};
      save();
    } catch {
      /* começa vazio */
    }
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

// ---------- Conversas (painel /admin) ----------
function getConv(phone) {
  return (
    store.conversations[phone] ||
    (store.conversations[phone] = {
      phone,
      name: null,
      messages: [],
      escalated: false,
      flow: null,
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
  return Object.values(store.conversations).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function isEscalated(phone) {
  return Boolean(store.conversations[phone]?.escalated);
}

// Histórico recente no formato do orquestrador de IA (para reidratar sessões após restart)
export function recentHistory(phone, n = 20) {
  const c = store.conversations[phone];
  if (!c) return [];
  return c.messages.slice(-n).map((m) => ({
    role: m.dir === "in" ? "user" : "assistant",
    content: m.text,
  }));
}

export function contactName(phone) {
  return store.conversations[phone]?.name || null;
}

// ---------- Fluxo do atendimento (fase + dados coletados) ----------
export function getFlow(phone) {
  return getConv(phone).flow || { phase: "triagem", dados: {} };
}

export function setFlow(phone, patch) {
  const c = getConv(phone);
  const cur = c.flow || { phase: "triagem", dados: {} };
  c.flow = { ...cur, ...patch, dados: { ...cur.dados, ...(patch.dados || {}) } };
  c.updatedAt = Date.now();
  save();
  return c.flow;
}

export function resetFlow(phone) {
  const c = getConv(phone);
  c.flow = { phase: "triagem", dados: {} };
  c.updatedAt = Date.now();
  save();
}

// ---------- Tickets ----------
export function setTicket(phone, data) {
  store.tickets[phone] = {
    phone,
    phase: "acompanhamento",
    lastCommentId: 0,
    pendingTech: null,
    createdAt: Date.now(),
    ...data,
    updatedAt: Date.now(),
  };
  save();
  return store.tickets[phone];
}

export function getTicket(phone) {
  return store.tickets[phone] || null;
}

export function updateTicket(phone, patch) {
  const t = store.tickets[phone];
  if (!t) return null;
  Object.assign(t, patch, { updatedAt: Date.now() });
  save();
  return t;
}

export function archiveTicket(phone, finalStatus) {
  const t = store.tickets[phone];
  if (!t) return;
  delete store.tickets[phone];
  store.ticketHistory.push({ ...t, status: finalStatus || t.status, closedAt: Date.now() });
  if (store.ticketHistory.length > 500) store.ticketHistory = store.ticketHistory.slice(-500);
  save();
}

export function activeTickets() {
  return Object.values(store.tickets);
}

// ---------- Alertas para o operador ----------
export function addAlert({ phone, ticket, message, reason }) {
  store.alerts.unshift({
    ts: Date.now(),
    phone,
    name: contactName(phone),
    ticket: ticket || null,
    message,
    reason: reason || "",
  });
  if (store.alerts.length > 200) store.alerts = store.alerts.slice(0, 200);
  save();
  console.warn(`[ALERTA OPERADOR] ${phone}${ticket ? ` (${ticket})` : ""}: ${reason} -> "${message}"`);
}

export function allAlerts() {
  return store.alerts;
}

// ---------- Notificações pendentes (fora da janela de 24h) ----------
export function addPending(phone, message) {
  (store.pending[phone] || (store.pending[phone] = [])).push(message);
  save();
}

export function drainPending(phone) {
  const msgs = store.pending[phone] || [];
  delete store.pending[phone];
  if (msgs.length) save();
  return msgs;
}
