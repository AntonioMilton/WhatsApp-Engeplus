// Monitor do ciclo de vida dos tickets: consulta o Jira periodicamente e
// mantém o usuário informado pelo WhatsApp sempre que houver mudança relevante
// (status novo, comentário da equipe, resolução, fechamento, reabertura).
//
// Fora da janela de 24h a Meta rejeita mensagens comuns: nesses casos a
// notificação fica na fila (entregue quando o usuário escrever de novo) e um
// alerta é gerado para o operador enviar manualmente por outro meio.

import { sendText } from "./whatsapp.js";
import { getIssue, getBotAccountId, isConfigured } from "./jira.js";
import {
  activeTickets,
  updateTicket,
  archiveTicket,
  addAlert,
  addPending,
  logMessage,
  resetFlow,
} from "./store.js";
import { pushMessage } from "./session.js";

const POLL_MS = Math.max(15, Number(process.env.JIRA_POLL_SECONDS) || 60) * 1000;

export function startMonitor() {
  if (!isConfigured()) {
    console.warn("[monitor] JIRA_EMAIL/JIRA_API_TOKEN não configurados — monitor desativado.");
    return;
  }
  console.log(`[monitor] acompanhando tickets a cada ${POLL_MS / 1000}s`);
  setInterval(tick, POLL_MS).unref?.();
}

let running = false;
export async function tick() {
  if (running) return; // evita sobreposição se o Jira estiver lento
  running = true;
  try {
    for (const t of activeTickets()) {
      try {
        await checkTicket(t);
      } catch (e) {
        console.error(`[monitor] erro no ticket ${t.key}:`, e.message);
      }
    }
  } finally {
    running = false;
  }
}

// Envia notificação proativa; se falhar (ex.: fora da janela de 24h),
// enfileira para o próximo contato e alerta o operador.
export async function notify(phone, message, ticketKey) {
  try {
    await sendText(phone, message);
    logMessage(phone, "out", message);
    pushMessage(phone, "assistant", message);
  } catch (e) {
    addPending(phone, message);
    addAlert({
      phone,
      ticket: ticketKey,
      message,
      reason: `Falha ao notificar pelo WhatsApp (provável janela de 24h expirada): ${e.message}. Envie manualmente por outro meio.`,
    });
  }
}

// Explicação amigável de cada status (linguagem simples + próximo passo)
export function explainStatus(status, ticketKey) {
  const s = status.toLowerCase();
  if (/reab|reopen/.test(s))
    return `🔄 Seu chamado ${ticketKey} foi *reaberto* e voltou para a fila da equipe. Sigo acompanhando e te aviso das novidades.`;
  if (/triag|aberto|open|to do|backlog|novo|new/.test(s))
    return `📥 Atualização do chamado ${ticketKey}: ele está *em triagem* — a equipe está avaliando para direcionar ao técnico certo. Te aviso quando o atendimento começar.`;
  if (/andamento|atendimento|progress|doing/.test(s))
    return `🔧 Boa notícia! Seu chamado ${ticketKey} está *em atendimento* — um técnico já está trabalhando nele. Te aviso assim que houver novidade.`;
  if (/aguardando cliente|aguardando solicitante|waiting for customer|pendente|pending/.test(s))
    return `✋ O chamado ${ticketKey} está *aguardando informações suas*. Pode responder por aqui mesmo que eu registro para a equipe.`;
  if (/aguardando|waiting|espera/.test(s))
    return `⏳ Atualização do chamado ${ticketKey}: está *em espera* (${status}). Assim que a equipe retomar, te aviso.`;
  if (/test|homolog|valida/.test(s))
    return `🧪 Atualização do chamado ${ticketKey}: a solução está *em testes*. Se estiver tudo certo, ele será marcado como resolvido em breve.`;
  return `ℹ️ Atualização do chamado ${ticketKey}: o status mudou para *${status}*. Sigo acompanhando e qualquer novidade te aviso por aqui.`;
}

async function checkTicket(t) {
  const issue = await getIssue(t.key);
  const botId = await getBotAccountId().catch(() => null);

  // ---- 1. Novos comentários da equipe (solicitação de informações etc.) ----
  const newComments = issue.comments.filter(
    (c) =>
      Number(c.id) > Number(t.lastCommentId || 0) &&
      c.public &&
      c.author &&
      c.author !== botId &&
      c.text
  );
  const maxSeen = issue.comments.reduce(
    (m, c) => Math.max(m, Number(c.id) || 0),
    Number(t.lastCommentId || 0)
  );
  if (maxSeen !== Number(t.lastCommentId || 0)) updateTicket(t.phone, { lastCommentId: maxSeen });

  const resolvedNow = issue.statusCategory === "done";
  for (const c of newComments) {
    // Em caso de resolução, o comentário é apresentado junto da mensagem de resolução (abaixo)
    if (resolvedNow) continue;
    updateTicket(t.phone, { pendingTech: c.text });
    await notify(
      t.phone,
      `💬 A equipe de suporte comentou no seu chamado ${t.key}:\n\n"${c.text}"\n\nPode responder por aqui mesmo que eu registro no chamado, tá?`,
      t.key
    );
  }

  // ---- 2. Mudança de status ----
  if (issue.status === t.status) return;
  const closedForGood = /fechad|closed|cancelad|cancelled|canceled/i.test(issue.status);

  if (resolvedNow && !closedForGood) {
    // Resolvido -> apresenta a solução e pede confirmação do usuário
    const lastTech = [...issue.comments]
      .reverse()
      .find((c) => c.public && c.author && c.author !== botId && c.text);
    const solucao = lastTech
      ? `A solução registrada pela equipe foi:\n\n"${lastTech.text}"\n\n`
      : issue.resolution
        ? `Resolução registrada: ${issue.resolution}.\n\n`
        : "";
    updateTicket(t.phone, { status: issue.status, phase: "resolucao" });
    await notify(
      t.phone,
      `✅ Seu chamado ${t.key} foi marcado como *resolvido* pela equipe!\n\n${solucao}Pode me confirmar se o problema foi realmente resolvido aí? Se estiver tudo certo eu encerro o chamado; se não, eu reabro na hora.`,
      t.key
    );
    return;
  }

  if (closedForGood) {
    // Fechado direto (ou cancelado) -> informa e finaliza o atendimento
    await notify(
      t.phone,
      `🔒 Seu chamado ${t.key} foi *encerrado* pela equipe de suporte (status: ${issue.status}). Se o problema voltar ou precisar de algo mais, é só me chamar por aqui que eu abro um novo atendimento!`,
      t.key
    );
    archiveTicket(t.phone, issue.status);
    resetFlow(t.phone);
    return;
  }

  updateTicket(t.phone, { status: issue.status, phase: "acompanhamento" });
  await notify(t.phone, explainStatus(issue.status, t.key), t.key);
}
