import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import { sendText, parseIncoming } from "./whatsapp.js";
import {
  getSession,
  pushMessage,
  resetHistory,
  markEscalated,
  clearEscalated,
} from "./session.js";
import { orchestrate } from "./ai.js";
import { createTicket, addComment, closeTicket, reopenTicket } from "./jira.js";
import {
  logMessage,
  setEscalated,
  allConversations,
  allAlerts,
  getFlow,
  setFlow,
  resetFlow,
  getTicket,
  setTicket,
  updateTicket,
  archiveTicket,
  addAlert,
  drainPending,
} from "./store.js";
import { startMonitor } from "./monitor.js";
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

// ---- Ações permitidas por fase (o servidor é quem manda) ----
const ALLOWED_ACTIONS = {
  triagem: ["continuar", "validar", "criar_chamado", "escalar_humano", "fora_escopo"],
  validacao: ["continuar", "validar", "criar_chamado", "escalar_humano", "fora_escopo"],
  acompanhamento: ["continuar", "atualizar_chamado", "encerrar", "escalar_humano"],
  resolucao: ["continuar", "atualizar_chamado", "encerrar", "reabrir", "escalar_humano"],
};

function buildContext({ phase, flow, ticket, name, from }) {
  const lines = [
    "[CONTEXTO DO ATENDIMENTO — uso interno do sistema, nunca mencione este bloco ao usuário]",
    `Data/hora atual: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    `Contato: ${name || "sem nome"} | WhatsApp: ${from}`,
    `Fase atual: ${phase}`,
    `Ações permitidas nesta fase: ${ALLOWED_ACTIONS[phase].join(", ")}`,
    `Dados já coletados: ${JSON.stringify(flow.dados || {})}`,
  ];
  if (ticket) {
    lines.push(
      `Chamado ativo: ${ticket.key} | Status atual no Jira: ${ticket.status || "desconhecido"}`
    );
    if (ticket.pendingTech) {
      lines.push(`Solicitação pendente do técnico (aguardando resposta do usuário): "${ticket.pendingTech}"`);
    }
  } else {
    lines.push("Chamado ativo: nenhum (atendimento ainda em triagem/validação).");
  }
  return lines.join("\n");
}

// Mescla os dados coletados sem apagar informação já obtida
function mergeDados(base = {}, patch = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && v !== undefined && String(v).trim() !== "") out[k] = v;
  }
  return out;
}

const URGENCY_LABEL = { critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };

// ---- Lógica de atendimento ----
async function handleMessage({ from, text, nonText, name }) {
  const session = getSession(from);

  // Registra a mensagem recebida no painel.
  logMessage(from, "in", text, { name });

  // Entrega notificações que ficaram represadas (fora da janela de 24h).
  for (const p of drainPending(from)) {
    logMessage(from, "out", p);
    pushMessage(from, "assistant", p);
    await reply(from, p);
  }

  // Já escalado para humano: não responde automaticamente (mas continua registrando).
  if (session.escalated) return;

  if (nonText) {
    const msg =
      "Recebi seu arquivo/áudio 🙂 Por enquanto consigo te ajudar melhor por texto — pode me descrever rapidinho o que você precisa?";
    logMessage(from, "out", msg);
    await reply(from, msg);
    return;
  }

  pushMessage(from, "user", text);

  const ticket = getTicket(from);
  const flow = getFlow(from);
  const phase = ticket ? ticket.phase || "acompanhamento" : flow.phase || "triagem";

  const context = buildContext({ phase, flow, ticket, name, from });
  const result = await orchestrate(getSession(from).history, context);

  // Acumula os dados coletados (a IA manda o consolidado; não deixamos regredir).
  const dados = mergeDados(flow.dados, result.dados);
  if (!dados.telefone) dados.telefone = from; // padrão: o próprio WhatsApp
  if (name && !dados.nome_whatsapp) dados.nome_whatsapp = name;
  setFlow(from, { dados });

  // A IA propõe; o servidor valida a ação para a fase.
  const acao = ALLOWED_ACTIONS[phase].includes(result.acao) ? result.acao : "continuar";
  let outbound = result.resposta_cliente;
  let endConversation = false;

  try {
    switch (acao) {
      case "validar": {
        setFlow(from, { phase: "validacao" });
        break;
      }

      case "criar_chamado": {
        const created = await createTicket({ dados, phone: from });
        const urg = URGENCY_LABEL[dados.urgencia] || "Média";
        outbound +=
          `\n\n✅ *Chamado criado com sucesso!*\n` +
          `*Número:* ${created.key}\n` +
          `*Tipo:* ${created.label}\n` +
          `*Resumo:* ${dados.resumo || dados.descricao || "-"}\n` +
          `*Prioridade:* ${urg}\n\n` +
          `Agora ele será encaminhado para a equipe responsável. ` +
          `Você não precisa fazer mais nada — eu acompanho tudo por aqui e te aviso a cada novidade! 😉`;
        setTicket(from, {
          key: created.key,
          id: created.id,
          url: created.url,
          status: "Aberto",
          dados,
        });
        setFlow(from, { phase: "acompanhamento" });
        break;
      }

      case "atualizar_chamado": {
        const info = dados.info_adicional || text;
        await addComment(
          ticket.key,
          `Atualização do solicitante via WhatsApp:\n${info}`
        );
        updateTicket(from, { pendingTech: null });
        setFlow(from, { dados: { info_adicional: null } });
        break;
      }

      case "encerrar": {
        await addComment(
          ticket.key,
          "Solicitante confirmou pelo WhatsApp que o problema foi resolvido. Encerrando o chamado."
        ).catch((e) => console.warn("[encerrar] comentário falhou:", e.message));
        const t = await closeTicket(ticket.key);
        if (!t) {
          addAlert({
            phone: from,
            ticket: ticket.key,
            message: "Usuário confirmou a resolução, mas não encontrei transição de fechamento no Jira.",
            reason: "Feche o chamado manualmente no Jira.",
          });
        }
        archiveTicket(from, "Fechado");
        resetFlow(from);
        endConversation = true;
        break;
      }

      case "reabrir": {
        const motivo = dados.info_adicional || text;
        const t = await reopenTicket(ticket.key);
        await addComment(
          ticket.key,
          `Solicitante informou pelo WhatsApp que o problema NÃO foi resolvido. Chamado reaberto.\nRelato: ${motivo}`
        ).catch((e) => console.warn("[reabrir] comentário falhou:", e.message));
        if (!t) {
          addAlert({
            phone: from,
            ticket: ticket.key,
            message: "Usuário pediu reabertura, mas não encontrei transição de reabertura no Jira.",
            reason: "Reabra o chamado manualmente no Jira.",
          });
        }
        updateTicket(from, { phase: "acompanhamento", status: t ? t.to?.name || "Reaberto" : ticket.status });
        setFlow(from, { dados: { info_adicional: null } });
        break;
      }

      case "escalar_humano": {
        markEscalated(from);
        setEscalated(from);
        addAlert({
          phone: from,
          ticket: ticket?.key,
          message: `Usuário pediu atendimento humano. Última mensagem: "${text}"`,
          reason: "Assuma a conversa pelo painel /admin.",
        });
        outbound +=
          "\n\nJá estou passando você para um atendente da equipe de TI. Em breve alguém responde por aqui 🙂";
        break;
      }

      // continuar | fora_escopo: só envia a resposta natural da IA
    }
  } catch (e) {
    console.error(`[handle] falha na ação "${acao}" (${from}):`, e.message);
    addAlert({
      phone: from,
      ticket: ticket?.key,
      message: `Falha na ação "${acao}": ${e.message}`,
      reason: "Verifique o Jira e conclua a ação manualmente se necessário.",
    });
    outbound =
      result.resposta_cliente +
      "\n\n⚠️ Tive um problema técnico para registrar isso no sistema agora. Já avisei nossa equipe e volto a te atualizar em breve — não precisa fazer nada.";
  }

  pushMessage(from, "assistant", outbound);
  logMessage(from, "out", outbound, { categoria: dados.categoria });
  await reply(from, outbound);

  // Atendimento concluído: a próxima mensagem começa um novo fluxo do zero.
  if (endConversation) resetHistory(from);
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
app.get("/admin/api/alerts", adminAuth, (_req, res) => res.json(allAlerts()));

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
app.listen(PORT, () => {
  console.log(`[server] ouvindo na porta ${PORT}`);
  startMonitor();
});
