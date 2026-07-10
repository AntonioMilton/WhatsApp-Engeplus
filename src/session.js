// Armazenamento de estado da conversa em memória.
// MVP: mapa por número de telefone. Para produção, trocar por Redis/banco
// (a memória some quando o processo reinicia e não escala entre instâncias).

const SESSIONS = new Map();
const TTL_MS = 1000 * 60 * 60 * 6; // 6h de inatividade -> limpa a sessão

export function getSession(phone) {
  const now = Date.now();
  let s = SESSIONS.get(phone);
  if (!s || now - s.updatedAt > TTL_MS) {
    s = { phone, history: [], escalated: false, createdAt: now, updatedAt: now };
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

export function markEscalated(phone) {
  const s = getSession(phone);
  s.escalated = true;
  s.updatedAt = Date.now();
}

// Limpeza periódica de sessões velhas
setInterval(() => {
  const now = Date.now();
  for (const [phone, s] of SESSIONS) {
    if (now - s.updatedAt > TTL_MS) SESSIONS.delete(phone);
  }
}, 1000 * 60 * 30).unref?.();
