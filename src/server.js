import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import { sendText, parseIncoming } from "./whatsapp.js";
import { getSession, pushMessage, markEscalated, clearEscalated } from "./session.js";
import { orchestrate } from "./ai.js";
import { linkFor, PORTAL_HOME } from "./jira-links.js";
import { logMessage, setEscalated, allConversations } from "./store.js";
import { DASHBOARD_HTML } from "./dashboard.js";

const app = express();

// Precisamos do corpo bruto para validar a assinatura do webhook da Meta.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---- 1. Verificação do webhook (GET) ----
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("[webhook] verificado com sucesso");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---- Validação da assinatura X-Hub-Signature-256 ----
function validSignature(req) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true; // em dev sem secret, não bloqueia
  const signature = req.get("x-hub-signature-256") || "";
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---- 2. Recebimento de mensagens (POST) ----
app.post("/webhook", (req, res) => {
  if (!validSignature(req)) {
    console.warn("[webhook] assinatura inválida");
    return res.sendStatus(401);
  }
  // Responde imediatamente (Meta exige 200 em < 5s). Processa em background.
  res.sendStatus(200);

  const messages = parseIncoming(req.body);
  for (const m of messages) {
    handleMessage(m).catch((e) => console.error("[handle] erro:", e));
  }
});

// ---- Lógica de atendimento ----
async function handleMessage({ from, text, nonText, name }) {
  const session = getSession(from);

  // Registra a mensagem recebida no painel.
  logMessage(from, "in", text, { name });

  // Já escalado para humano: não responde automaticamente (mas continua registrando).
  if (session.escalated) return;

  if (nonText) {
    const msg = "Recebi seu arquivo/áudio 🙂 Por enquanto consigo te ajudar melhor por texto — pode me descrever rapidinho o que você precisa?";
    logMessage(from, "out", msg);
    await reply(from, msg);
    return;
  }

  pushMessage(from, "user", text);
  const session2 = getSession(from);

  const result = await orchestrate(session2.history);
  let outbound = result.resposta_cliente;

  if (result.acao === "enviar_link") {
    const { label, url } = linkFor(result.categoria);
    outbound += `\n\n👉 *${label}*\n${url}\n\nÉ só preencher que o chamado abre na nossa fila de suporte. Qualquer dúvida, é só me chamar por aqui!`;
  } else if (result.acao === "escalar_humano") {
    markEscalated(from);
    setEscalated(from);
    outbound += "\n\nJá estou passando você para um atendente da equipe de TI. Em breve alguém responde por aqui 🙂";
  } else if (result.acao === "fora_escopo") {
    outbound += `\n\nSe precisar de algo de TI, estou por aqui. Você também pode ver todos os tipos de atendimento em: ${PORTAL_HOME}`;
  }

  pushMessage(from, "assistant", result.resposta_cliente);
  logMessage(from, "out", outbound, { categoria: result.categoria });
  await reply(from, outbound);
}

async function reply(to, body) {
  try {
    await sendText(to, body);
  } catch (e) {
    console.error("[reply] falha:", e.message);
  }
}

app.get("/", (_req, res) => res.send("WhatsApp Suporte TI — OK"));

// ---- Painel de monitoramento (protegido por Basic Auth) ----
function adminAuth(req, res, next) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) {
    return res.status(503).send("Painel não configurado: defina ADMIN_USER e ADMIN_PASS no .env");
  }
  const header = req.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [u, p] = Buffer.from(encoded, "base64").toString().split(":");
    if (u === user && p === pass) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Painel Suporte TI"').status(401).send("Autenticação necessária");
}

app.get("/admin", adminAuth, (_req, res) => res.type("html").send(DASHBOARD_HTML));
app.get("/admin/api/conversations", adminAuth, (_req, res) => res.json(allConversations()));

// Responder manualmente uma conversa (assume o atendimento; bot para de responder este contato)
app.post("/admin/api/reply", adminAuth, async (req, res) => {
  const { phone, text } = req.body || {};
  if (!phone || !text || !text.trim()) {
    return res.status(400).json({ error: "Informe phone e text." });
  }
  try {
    await sendText(phone, text.trim());
    logMessage(phone, "out", text.trim());
    markEscalated(phone); // bot para de responder automaticamente este contato
    setEscalated(phone, true);
    res.json({ ok: true });
  } catch (e) {
    // Ex.: fora da janela de 24h -> a Meta rejeita mensagem não-template
    res.status(502).json({ error: e.message });
  }
});

// Devolver a conversa ao bot
app.post("/admin/api/reactivate", adminAuth, (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: "Informe phone." });
  clearEscalated(phone);
  setEscalated(phone, false);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] ouvindo na porta ${PORT}`));
