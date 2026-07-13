// Estado da conversa em memória (histórico para a IA).
// A fonte de verdade do fluxo/ticket é o store.js (persistido em disco);
// aqui fica só o histórico corrente. Sessões novas são reidratadas do store,
// então o contexto sobrevive a reinícios do processo.

import { recentHistory, isEscalated } from "./store.js";

const SESSIONS = new Map();
const TTL_MS = 1000 * 60 * 60 * 6; // 6h de inatividade -> limpa a sessão

export function getSession(phone) {
  const now = Date.now();
  let s = SESSIONS.get(phone);
  if (!s || now - s.updatedAt > TTL_MS) {
    s = {
      phone,
      history: recentHistory(phone, 20),
      escalated: isEscalated(phone),
      createdAt: now,
      updatedAt: now,
    };
    SESSIONS.set(phone, s);
  }
  return s;
}

export function pushMessage(phone, role, content) {
  const s = getSession(phone);
  s.history.push({ role, content });
  // Mantém a janela de contexto enxuta (últimas 20 mensagens)
  if (s.history.length > 20) s.history = s.history.slice(-20);
  s.updatedAt = Date.now();
  return s;
}

// Limpa o histórico (novo atendimento após encerramento do anterior)
export function resetHistory(phone) {
  const s = getSession(phone);
  s.history = [];
  s.updatedAt = Date.now();
}

export function markEscalated(phone) {
  const s = getSession(phone);
  s.escalated = true;
  s.updatedAt = Date.now();
}

export function clearEscalated(phone) {
  const s = getSession(phone);
  s.escalated = false;
  s.updatedAt = Date.now();
}

// Limpeza periódica de sessões velhas
setInterval(() => {
  const now = Date.now();
  for (const [phone, s] of SESSIONS) {
    if (now - s.updatedAt > TTL_MS) SESSIONS.delete(phone);
  }
}, 1000 * 60 * 30).unref?.();
