// Edge cases: fallback de criação no Jira, ação inválida por fase, falha total do Jira,
// migração do formato antigo do store.
process.env.PORT = "3125";
process.env.AI_PROVIDER = "anthropic";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.ANTHROPIC_BASE_URL = "http://localhost:3126";
process.env.WHATSAPP_TOKEN = "t";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1";
process.env.META_APP_SECRET = "";
process.env.JIRA_EMAIL = "bot@x";
process.env.JIRA_API_TOKEN = "tok";
process.env.JIRA_POLL_SECONDS = "3600";

import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";

const outbox = [];
const creates = [];
const aiQueue = [];
let jiraMode = "strict"; // strict: rejeita payload com campos JSM | down: sempre 500
let passed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(desc, cond) {
  if (!cond) { console.error(`✗ FALHOU: ${desc}`); process.exit(1); }
  passed++; console.log(`✓ ${desc}`);
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.includes("graph.facebook.com")) {
    outbox.push({ to: body.to, body: body.text.body });
    return new Response(JSON.stringify({ messages: [{ id: "x" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.includes("atlassian.net")) {
    if (u.endsWith("/rest/api/3/issue") && method === "POST") {
      creates.push(body);
      if (jiraMode === "down") return new Response("boom", { status: 500 });
      if (jiraMode === "strict" && body.fields.customfield_10010)
        return new Response(JSON.stringify({ errors: { customfield_10010: "Field cannot be set" } }), { status: 400 });
      return new Response(JSON.stringify({ id: "1", key: "SUP-500" }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/myself")) return new Response(JSON.stringify({ accountId: "bot" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, opts);
};

// Mock IA
const aiServer = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const scripted = aiQueue.shift() || { resposta_cliente: "?", acao: "continuar", dados: {} };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: JSON.stringify(scripted) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => aiServer.listen(3126, r));

// ---- migração: formato legado antes de importar o servidor ----
fs.rmSync("data", { recursive: true, force: true });
fs.mkdirSync("data");
fs.writeFileSync("data/conversations.json", JSON.stringify({
  "5547900000000": { phone: "5547900000000", name: "Legado", messages: [{ dir: "in", text: "oi", ts: 1 }], escalated: false, updatedAt: 1 },
}));

await import("../src/server.js");
await sleep(200);

const { allConversations } = await import("../src/store.js");
ok("A. migra store legado (conversations.json)", allConversations().some((c) => c.name === "Legado"));

async function userSays(from, text) {
  const before = outbox.length;
  await realFetch("http://localhost:3125/webhook", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: "T" } }], messages: [{ type: "text", from, text: { body: text } }] } }] }] }),
  });
  for (let i = 0; i < 100 && outbox.length === before; i++) await sleep(30);
  return outbox.slice(before);
}

const dados = { nome: "X", categoria: "software", resumo: "Instalar AutoCAD", descricao: "Preciso do AutoCAD instalado", urgencia: "media" };

// B. ação inválida para a fase (reabrir sem ticket) -> vira continuar, sem crash
aiQueue.push({ resposta_cliente: "Certo!", acao: "reabrir", dados });
let msgs = await userSays("5547944444444", "oi");
ok("B. ação inválida coerçida para continuar", msgs.length === 1 && !msgs[0].body.includes("⚠️"));

// C. fallback de criação: 400 com campos JSM -> retry sem eles
aiQueue.push({ resposta_cliente: "Abrindo!", acao: "criar_chamado", dados });
msgs = await userSays("5547944444444", "pode abrir");
ok("C. fallback cria sem campos JSM", msgs[0].body.includes("SUP-500") && creates.length === 2 && !creates[1].fields.customfield_10010);

// D. Jira fora do ar -> desculpa + alerta, fase preservada
jiraMode = "down";
aiQueue.push({ resposta_cliente: "Vou abrir seu chamado.", acao: "criar_chamado", dados });
msgs = await userSays("5547955555555", "pode abrir");
ok("D. falha do Jira: mensagem de contingência", msgs[0].body.includes("problema técnico"));
await sleep(600);
const stored = JSON.parse(fs.readFileSync("data/store.json", "utf8"));
ok("D2. alerta registrado para o operador", stored.alerts.some((a) => a.phone === "5547955555555" && a.message.includes("criar_chamado")));
ok("D3. nenhum ticket fantasma registrado", !stored.tickets["5547955555555"]);

console.log(`\n${passed} verificações passaram ✅`);
process.exit(0);
