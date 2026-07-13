// Cliente da API REST do Jira Cloud (v3) — projeto SUP (Central de Suporte de TI).
// Autenticação: Basic (JIRA_EMAIL + JIRA_API_TOKEN no .env).
// Metadados reais coletados do site ti-petkov.atlassian.net em 13/07/2026.

const BASE = (process.env.JIRA_BASE_URL || "https://ti-petkov.atlassian.net").replace(/\/+$/, "");
const PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "SUP";
const ASSIGNEE_ID =
  process.env.JIRA_ASSIGNEE_ACCOUNT_ID || "712020:128a5a09-e336-4fa4-8510-194b1a4c2dd3"; // AntonioMilton

// Issue types do projeto SUP
export const ISSUE_TYPES = {
  incident: "10008", // [System] Incident
  serviceRequest: "10009", // [System] Service request
};

// categoria da IA -> { tipo de item, request type do portal (customfield_10010), rótulo }
export const CATEGORY_MAP = {
  acesso_senha: { issueType: ISSUE_TYPES.serviceRequest, requestType: "3", label: "Solicitar Acesso ao Sistema" },
  acesso_privilegiado: { issueType: ISSUE_TYPES.serviceRequest, requestType: "2", label: "Solicitar Acesso Privilegiado" },
  hardware: { issueType: ISSUE_TYPES.incident, requestType: "7", label: "Reportar Falha em Hardware" },
  equipamento: { issueType: ISSUE_TYPES.serviceRequest, requestType: "9", label: "Solicitar Equipamento" },
  software: { issueType: ISSUE_TYPES.serviceRequest, requestType: "4", label: "Solicitar Software ou Licença" },
  email: { issueType: ISSUE_TYPES.serviceRequest, requestType: "3", label: "Solicitar Acesso ao Sistema" },
  rede_internet: { issueType: ISSUE_TYPES.incident, requestType: "6", label: "Reportar Incidente" },
  incidente: { issueType: ISSUE_TYPES.incident, requestType: "6", label: "Reportar Incidente" },
  onboarding: { issueType: ISSUE_TYPES.serviceRequest, requestType: "8", label: "Integração de Novo Colaborador" },
  outros: { issueType: ISSUE_TYPES.serviceRequest, requestType: "1", label: "Solicitar Suporte de TI" },
};

// urgência da IA -> prioridade do Jira (id) e Urgency do JSM (customfield_10044)
export const URGENCY_MAP = {
  critica: { priority: "1", urgencyOption: "10020" }, // Highest / Critical
  alta: { priority: "2", urgencyOption: "10021" }, // High / High
  media: { priority: "3", urgencyOption: "10022" }, // Medium / Medium
  baixa: { priority: "4", urgencyOption: "10023" }, // Low / Low
};

export function ticketUrl(key) {
  return `${BASE}/browse/${key}`;
}

export function isConfigured() {
  return Boolean(process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);
}

function authHeader() {
  return (
    "Basic " +
    Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64")
  );
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Jira ${method} ${path} -> ${res.status}: ${text.slice(0, 600)}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---- Identidade do bot (para ignorar os próprios comentários no monitor) ----
let myselfPromise = null;
export function getBotAccountId() {
  if (!myselfPromise) {
    myselfPromise = api("/rest/api/3/myself")
      .then((u) => u.accountId)
      .catch((e) => {
        myselfPromise = null; // permite nova tentativa
        throw e;
      });
  }
  return myselfPromise;
}

// ---- Helpers de ADF (Atlassian Document Format) ----
function adfParagraph(text) {
  return {
    type: "paragraph",
    content: text ? [{ type: "text", text: String(text) }] : [],
  };
}

function adfHeading(text) {
  return { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text }] };
}

export function adfDoc(sections) {
  // sections: [{ title?, text }]
  const content = [];
  for (const s of sections) {
    if (!s.text) continue;
    if (s.title) content.push(adfHeading(s.title));
    for (const line of String(s.text).split("\n")) content.push(adfParagraph(line));
  }
  if (!content.length) content.push(adfParagraph(""));
  return { type: "doc", version: 1, content };
}

export function adfToText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  const inner = (node.content || []).map(adfToText).join("");
  return ["paragraph", "heading"].includes(node.type) ? inner + "\n" : inner;
}

// ---- Descrição padronizada do chamado ----
const FIELD_LABELS = [
  ["nome", "Solicitante"],
  ["telefone", "Telefone de contato"],
  ["afetado", "O que foi afetado"],
  ["sintomas", "Sintomas"],
  ["mensagens_erro", "Mensagens de erro"],
  ["passos", "Passos que levaram ao problema"],
  ["inicio", "Início do problema"],
  ["usuarios_afetados", "Usuários afetados"],
  ["impacto", "Impacto"],
  ["urgencia", "Urgência declarada"],
  ["info_adicional", "Informações adicionais"],
];

export function buildDescription(dados = {}, phone) {
  const sections = [{ title: "Descrição do problema", text: dados.descricao || dados.resumo || "-" }];
  const detalhes = FIELD_LABELS.filter(([k]) => dados[k])
    .map(([k, label]) => `${label}: ${dados[k]}`)
    .join("\n");
  if (detalhes) sections.push({ title: "Detalhes coletados no atendimento", text: detalhes });
  sections.push({
    title: "Origem",
    text: `Chamado aberto automaticamente pelo assistente de atendimento no WhatsApp (${phone || "número não identificado"}).`,
  });
  return adfDoc(sections);
}

// ---- Criação do chamado (com fallbacks progressivos) ----
export async function createTicket({ dados = {}, phone }) {
  const cat = CATEGORY_MAP[dados.categoria] || CATEGORY_MAP.outros;
  const urg = URGENCY_MAP[dados.urgencia] || URGENCY_MAP.media;
  const summary = (dados.resumo || dados.descricao || "Solicitação de suporte via WhatsApp").slice(0, 240);
  const description = buildDescription(dados, phone);

  const full = {
    fields: {
      project: { key: PROJECT_KEY },
      issuetype: { id: cat.issueType },
      summary,
      description,
      priority: { id: urg.priority },
      assignee: { accountId: ASSIGNEE_ID }, // Jira Cloud usa accountId (não "id")
      labels: ["whatsapp", `cat-${dados.categoria || "outros"}`],
      customfield_10010: cat.requestType, // Request Type do portal (JSM)
      customfield_10044: { id: urg.urgencyOption }, // Urgency (JSM)
    },
  };

  // Tentativas progressivas — remove um grupo de campos por vez para que campos
  // válidos (urgência, prioridade, responsável) sobrevivam mesmo quando o Request
  // Type (customfield_10010, tipo vp-origin) é recusado pelo REST create — o que
  // acontece no Jira real. Campos opcionais nunca devem impedir a abertura.
  const withoutRequestType = structuredClone(full);
  delete withoutRequestType.fields.customfield_10010; // mantém urgência/prioridade/responsável

  const withoutJsmFields = structuredClone(full);
  delete withoutJsmFields.fields.customfield_10010;
  delete withoutJsmFields.fields.customfield_10044;

  const minimal = {
    fields: {
      project: { key: PROJECT_KEY },
      issuetype: { id: cat.issueType }, // preserva Incident vs Service request
      summary,
      description,
    },
  };

  const attempts = [full, withoutRequestType, withoutJsmFields, minimal];

  let lastErr;
  for (const body of attempts) {
    try {
      const created = await api("/rest/api/3/issue", { method: "POST", body });
      return { key: created.key, id: created.id, url: ticketUrl(created.key), label: cat.label };
    } catch (e) {
      lastErr = e;
      if (e.status !== 400) break; // erro não relacionado a campos -> não insistir
      console.warn("[jira] criação falhou, tentando payload mais simples:", e.message);
    }
  }
  throw lastErr;
}

// ---- Comentários ----
export async function addComment(key, text) {
  return api(`/rest/api/3/issue/${key}/comment`, {
    method: "POST",
    body: { body: adfDoc([{ text }]) },
  });
}

// ---- Consulta de status + comentários ----
export async function getIssue(key) {
  const issue = await api(
    `/rest/api/3/issue/${key}?fields=status,resolution,comment,summary`
  );
  const f = issue.fields || {};
  const comments = (f.comment?.comments || []).map((c) => ({
    id: c.id,
    author: c.author?.accountId,
    authorName: c.author?.displayName,
    public: c.jsdPublic !== false,
    text: adfToText(c.body).trim(),
    created: c.created,
  }));
  return {
    key: issue.key,
    summary: f.summary,
    status: f.status?.name || "",
    statusCategory: f.status?.statusCategory?.key || "", // new | indeterminate | done
    resolution: f.resolution?.name || null,
    comments,
  };
}

// ---- Transições ----
export async function listTransitions(key) {
  const data = await api(`/rest/api/3/issue/${key}/transitions`);
  return data.transitions || [];
}

async function transitionMatching(key, { nameRegex, toCategory }) {
  const transitions = await listTransitions(key);
  let target =
    transitions.find((t) => nameRegex.test(t.name) || nameRegex.test(t.to?.name || "")) ||
    (toCategory ? transitions.find((t) => t.to?.statusCategory?.key === toCategory) : null);
  if (!target) return null;
  await api(`/rest/api/3/issue/${key}/transitions`, {
    method: "POST",
    body: { transition: { id: target.id } },
  });
  return target;
}

// Fecha o chamado (após confirmação do usuário)
export function closeTicket(key) {
  return transitionMatching(key, {
    nameRegex: /fech|clos|conclu|done|resolv/i,
    toCategory: "done",
  });
}

// Reabre o chamado (usuário informou que o problema persiste)
export function reopenTicket(key) {
  return transitionMatching(key, {
    nameRegex: /reab|reopen/i,
    toCategory: "indeterminate",
  });
}
