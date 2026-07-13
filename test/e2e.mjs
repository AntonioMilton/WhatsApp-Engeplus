// Teste ponta a ponta: sobe o servidor real com fetch mockado (Meta, Jira e IA).
process.env.PORT = "3123";
process.env.AI_PROVIDER = "anthropic";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.ANTHROPIC_BASE_URL = "http://localhost:3124";
process.env.WHATSAPP_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "12345";
process.env.WHATSAPP_VERIFY_TOKEN = "verify";
process.env.META_APP_SECRET = "";
process.env.JIRA_EMAIL = "bot@engeplus.eng.br";
process.env.JIRA_API_TOKEN = "jira-token";
process.env.JIRA_BASE_URL = "https://ti-petkov.atlassian.net";
process.env.JIRA_POLL_SECONDS = "3600"; // tick manual nos testes
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASS = "test";

import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";

// ---------------- Estado dos mocks ----------------
const outbox = [];            // mensagens enviadas ao WhatsApp [{to, body}]
const jiraCalls = { creates: [], comments: [], transitions: [] };
const aiQueue = [];           // respostas roteirizadas da IA
const aiRequests = [];        // corpos enviados à IA (para inspecionar contexto)
let waFail = false;           // simula janela de 24h expirada
let nextIssueKey = 101;
const issues = {};            // estado do Jira por key: {status, statusCategory, resolution, comments, transitions}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : null;

  // ---- Meta WhatsApp ----
  if (u.includes("graph.facebook.com")) {
    if (waFail) return new Response(JSON.stringify({ error: { message: "Re-engagement message", code: 131047 } }), { status: 400 });
    outbox.push({ to: body.to, body: body.text.body });
    return jsonResponse({ messages: [{ id: "wamid.test" }] });
  }

  // ---- Jira ----
  if (u.includes("ti-petkov.atlassian.net")) {
    if (u.includes("/rest/api/3/myself")) return jsonResponse({ accountId: "bot-account" });

    if (u.endsWith("/rest/api/3/issue") && method === "POST") {
      const key = `SUP-${nextIssueKey++}`;
      jiraCalls.creates.push({ key, body });
      issues[key] = {
        status: "Aberto", statusCategory: "new", resolution: null, comments: [],
        transitions: [
          { id: "31", name: "Fechar", to: { name: "Fechado", statusCategory: { key: "done" } } },
          { id: "41", name: "Reabrir", to: { name: "Reaberto", statusCategory: { key: "indeterminate" } } },
        ],
      };
      return jsonResponse({ id: String(90000 + nextIssueKey), key }, 201);
    }

    let m = u.match(/\/rest\/api\/3\/issue\/(SUP-\d+)\/comment$/);
    if (m && method === "POST") {
      jiraCalls.comments.push({ key: m[1], body });
      return jsonResponse({ id: "999" }, 201);
    }

    m = u.match(/\/rest\/api\/3\/issue\/(SUP-\d+)\/transitions$/);
    if (m) {
      const issue = issues[m[1]];
      if (method === "GET") return jsonResponse({ transitions: issue.transitions });
      jiraCalls.transitions.push({ key: m[1], id: body.transition.id });
      const t = issue.transitions.find((x) => x.id === body.transition.id);
      issue.status = t.to.name;
      issue.statusCategory = t.to.statusCategory.key;
      return new Response(null, { status: 204 });
    }

    m = u.match(/\/rest\/api\/3\/issue\/(SUP-\d+)\?/);
    if (m && method === "GET") {
      const i = issues[m[1]];
      return jsonResponse({
        key: m[1],
        fields: {
          summary: "teste",
          status: { name: i.status, statusCategory: { key: i.statusCategory } },
          resolution: i.resolution ? { name: i.resolution } : null,
          comment: { comments: i.comments },
        },
      });
    }
  }

  return realFetch(url, opts);
};

// ---- Mock da API da IA (o SDK da Anthropic usa fetch próprio) ----
const aiServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    aiRequests.push(JSON.parse(raw || "{}"));
    const scripted = aiQueue.shift();
    if (!scripted) {
      res.writeHead(500).end(JSON.stringify({ error: "aiQueue vazia" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "claude-test",
      content: [{ type: "text", text: JSON.stringify(scripted) }],
      stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
});
await new Promise((r) => aiServer.listen(3124, r));

// ---------------- Helpers ----------------
function adf(text) { return { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] }; }

async function userSays(from, text, name = "Contato Teste") {
  const before = outbox.length;
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name } }],
      messages: [{ type: "text", from, text: { body: text } }],
    } }] }],
  };
  const r = await realFetch("http://localhost:3123/webhook", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  assert.equal(r.status, 200);
  // espera o processamento em background
  for (let i = 0; i < 100 && outbox.length === before; i++) await sleep(30);
  await sleep(50);
  return outbox.slice(before);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (arr) => arr[arr.length - 1];
let passed = 0;
function ok(desc, cond) {
  if (!cond) { console.error(`✗ FALHOU: ${desc}`); process.exit(1); }
  passed++; console.log(`✓ ${desc}`);
}

// dados base coletados
const DADOS = {
  nome: "Carlos Silva", telefone: null, categoria: "email",
  resumo: "E-mail corporativo não abre — senha incorreta",
  descricao: "Usuário não consegue acessar o e-mail corporativo no PC; mensagem de senha incorreta sem ter alterado a senha.",
  afetado: "E-mail corporativo (Outlook)", sintomas: "Login recusado",
  mensagens_erro: "Senha incorreta", passos: "Tentou logar no Outlook ao chegar",
  inicio: "Hoje de manhã", usuarios_afetados: "1", impacto: "Não consegue trabalhar com e-mail",
  urgencia: "alta", info_adicional: null,
};

// ---------------- Cenários ----------------
fs.rmSync("data", { recursive: true, force: true });
await import("../src/server.js");
const { tick } = await import("../src/monitor.js");
await sleep(300);

const A = "5547911111111";

// 1. Triagem: primeira mensagem
aiQueue.push({ resposta_cliente: "Oi! Sou o assistente da TI e vou conduzir seu atendimento até o fim 🙂 Me conta: o que aconteceu com seu e-mail?", acao: "continuar", dados: { categoria: "email" } });
let msgs = await userSays(A, "oi, meu email não abre");
ok("1. triagem responde com pergunta", msgs.length === 1 && msgs[0].body.includes("assistente"));
ok("1b. contexto da IA informa fase triagem", JSON.stringify(last(aiRequests)).includes("Fase atual: triagem"));

// 2. Coleta -> validação (resumo)
aiQueue.push({ resposta_cliente: "Entendi. Seu problema é o seguinte: e-mail corporativo não abre por senha incorreta, começou hoje, urgência alta, afeta só você. Posso abrir o chamado?", acao: "validar", dados: DADOS });
msgs = await userSays(A, "sou o Carlos Silva, diz senha incorreta, começou hoje cedo, só eu, é urgente. Pode usar esse whatsapp mesmo.");
ok("2. IA valida com resumo antes de abrir", msgs[0].body.includes("Posso abrir o chamado"));

// 3. Confirmação -> criação do chamado
aiQueue.push({ resposta_cliente: "Perfeito, abrindo seu chamado agora!", acao: "criar_chamado", dados: DADOS });
msgs = await userSays(A, "pode abrir sim");
ok("3. informa número do ticket", msgs[0].body.includes("SUP-101") && msgs[0].body.includes("Chamado criado com sucesso"));
const create = jiraCalls.creates[0];
ok("3b. projeto SUP + tipo Service request", create.body.fields.project.key === "SUP" && create.body.fields.issuetype.id === "10009");
ok("3c. request type e urgency do JSM", create.body.fields.customfield_10010 === "3" && create.body.fields.customfield_10044.id === "10021");
ok("3d. prioridade High + responsável AntonioMilton", create.body.fields.priority.id === "2" && create.body.fields.assignee.accountId.startsWith("712020:"));
ok("3e. descrição contém dados coletados", JSON.stringify(create.body.fields.description).includes("Carlos Silva"));
ok("3f. contexto pós-criação: nenhum erro e fase validacao registrada", JSON.stringify(aiRequests[2]).includes("Fase atual: validacao"));

// 4. Monitor: mudança de status -> em atendimento
issues["SUP-101"].status = "Em Andamento"; issues["SUP-101"].statusCategory = "indeterminate";
let before = outbox.length;
await tick();
ok("4. notifica status em atendimento", outbox.length === before + 1 && last(outbox).body.includes("em atendimento"));

// 5. Monitor: técnico comenta pedindo informação
issues["SUP-101"].comments.push({ id: "601", author: { accountId: "tech-1", displayName: "Técnico" }, jsdPublic: true, body: adf("Qual o modelo do seu notebook?"), created: new Date().toISOString() });
before = outbox.length;
await tick();
ok("5. repassa pergunta do técnico", outbox.length === before + 1 && last(outbox).body.includes("Qual o modelo do seu notebook?"));

// 6. Usuário responde -> comentário no Jira
aiQueue.push({ resposta_cliente: "Anotado! Já registrei no chamado para a equipe.", acao: "atualizar_chamado", dados: { ...DADOS, info_adicional: "Notebook Dell Latitude 5440" } });
msgs = await userSays(A, "é um Dell Latitude 5440");
ok("6. resposta vira comentário no ticket", jiraCalls.comments.some((c) => JSON.stringify(c.body).includes("Dell Latitude 5440")));
ok("6b. contexto informou solicitação pendente do técnico", JSON.stringify(aiRequests[3]).includes("Solicitação pendente do técnico"));

// 7. Monitor: resolvido -> pede confirmação
issues["SUP-101"].status = "Resolvido"; issues["SUP-101"].statusCategory = "done"; issues["SUP-101"].resolution = "Done";
issues["SUP-101"].comments.push({ id: "602", author: { accountId: "tech-1", displayName: "Técnico" }, jsdPublic: true, body: adf("Senha do AD resetada e testada com o usuário."), created: new Date().toISOString() });
before = outbox.length;
await tick();
ok("7. informa resolução + solução aplicada", last(outbox).body.includes("resolvido") && last(outbox).body.includes("Senha do AD resetada"));

// 8. Usuário confirma -> encerra o ticket
aiQueue.push({ resposta_cliente: "Que ótimo! Encerro o chamado então. Qualquer coisa é só chamar. Atendimento finalizado 🙂", acao: "encerrar", dados: DADOS });
msgs = await userSays(A, "sim! resolvido, obrigado");
ok("8. transição de fechamento executada", jiraCalls.transitions.some((t) => t.key === "SUP-101" && t.id === "31"));
ok("8b. comentário de confirmação registrado", jiraCalls.comments.some((c) => JSON.stringify(c.body).includes("confirmou pelo WhatsApp")));
ok("8c. contexto da fase resolucao foi usado", JSON.stringify(aiRequests[4]).includes("Fase atual: resolucao"));

// 9. Nova mensagem depois do encerramento -> novo atendimento
aiQueue.push({ resposta_cliente: "Oi de novo! Como posso ajudar?", acao: "continuar", dados: {} });
msgs = await userSays(A, "oi, agora é outra coisa");
ok("9. pós-encerramento volta à triagem", JSON.stringify(last(aiRequests)).includes("Fase atual: triagem") && JSON.stringify(last(aiRequests)).includes("Chamado ativo: nenhum"));

// 10. Reabertura (telefone B)
const B = "5547922222222";
aiQueue.push({ resposta_cliente: "Resumo: internet caindo no setor. Posso abrir?", acao: "validar", dados: { ...DADOS, nome: "Ana", categoria: "rede_internet", urgencia: "critica", resumo: "Internet caindo no setor financeiro" } });
await userSays(B, "internet caiu aqui no financeiro, sou a Ana", "Ana");
aiQueue.push({ resposta_cliente: "Abrindo o chamado!", acao: "criar_chamado", dados: { ...DADOS, nome: "Ana", categoria: "rede_internet", urgencia: "critica", resumo: "Internet caindo no setor financeiro" } });
msgs = await userSays(B, "pode abrir", "Ana");
ok("10. incidente crítico: tipo Incident + prioridade Highest", jiraCalls.creates[1].body.fields.issuetype.id === "10008" && jiraCalls.creates[1].body.fields.priority.id === "1");
issues["SUP-102"].status = "Resolvido"; issues["SUP-102"].statusCategory = "done"; issues["SUP-102"].resolution = "Done";
await tick();
aiQueue.push({ resposta_cliente: "Poxa! Vou reabrir o chamado agora mesmo e a equipe volta a atuar.", acao: "reabrir", dados: { info_adicional: "Internet voltou por 10 minutos e caiu de novo." } });
msgs = await userSays(B, "não resolveu, caiu de novo", "Ana");
ok("10b. transição de reabertura + comentário", jiraCalls.transitions.some((t) => t.key === "SUP-102" && t.id === "41") && jiraCalls.comments.some((c) => JSON.stringify(c.body).includes("caiu de novo")));

// 11. Janela de 24h: notificação falha -> alerta + fila
waFail = true;
issues["SUP-102"].status = "Em Andamento"; issues["SUP-102"].statusCategory = "indeterminate"; issues["SUP-102"].resolution = null;
before = outbox.length;
await tick();
ok("11. fora da janela: nada enviado", outbox.length === before);
await sleep(600);
let stored = JSON.parse(fs.readFileSync("data/store.json", "utf8"));
ok("11b. alerta gerado para o operador", stored.alerts.some((a) => a.phone === B && /janela de 24h/.test(a.reason)));
ok("11c. notificação enfileirada", (stored.pending[B] || []).length === 1);
waFail = false;
aiQueue.push({ resposta_cliente: "Oi Ana! Seu chamado segue em atendimento.", acao: "continuar", dados: {} });
msgs = await userSays(B, "alguma novidade?", "Ana");
ok("11d. fila entregue quando o usuário escreve", msgs.length === 2 && msgs[0].body.includes("em atendimento"));

// 12. Escalar para humano (telefone C)
const C = "5547933333333";
aiQueue.push({ resposta_cliente: "Claro!", acao: "escalar_humano", dados: {} });
msgs = await userSays(C, "quero falar com um atendente humano");
ok("12. escala para humano", msgs[0].body.includes("atendente"));
before = outbox.length;
await realFetch("http://localhost:3123/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: "C" } }], messages: [{ type: "text", from: C, text: { body: "alo?" } }] } }] }] }) });
await sleep(400);
ok("12b. bot pausado após escalar", outbox.length === before);

// 13. Painel: alerts endpoint
const r = await realFetch("http://localhost:3123/admin/api/alerts", { headers: { Authorization: "Basic " + Buffer.from("admin:test").toString("base64") } });
const alerts = await r.json();
ok("13. /admin/api/alerts responde", r.status === 200 && Array.isArray(alerts) && alerts.length >= 2);

await sleep(600);
stored = JSON.parse(fs.readFileSync("data/store.json", "utf8"));
ok("14. SUP-101 arquivado no histórico", stored.ticketHistory.some((t) => t.key === "SUP-101") && !stored.tickets[A]);
ok("14b. SUP-102 segue ativo", stored.tickets[B]?.key === "SUP-102");

console.log(`\n${passed} verificações passaram ✅`);
process.exit(0);
