// Orquestrador de IA. Suporta OpenAI (GPT) e Anthropic (Claude).
// Escolha o provedor pela variável AI_PROVIDER = "openai" | "anthropic".
// Retorna JSON estruturado: { resposta_cliente, categoria, urgencia, acao }.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const PROVIDER = (process.env.AI_PROVIDER || "anthropic").toLowerCase();

const SYSTEM_PROMPT = `Você é o assistente virtual de atendimento da Central de Suporte de TI da Engeplus, atendendo pelo WhatsApp.

PERSONA
- Cordial, humano e objetivo. Português do Brasil, tom próximo mas profissional.
- Escreve mensagens curtas, adequadas ao WhatsApp (sem parágrafos longos, sem markdown pesado).

OBJETIVO
- Entender o problema/necessidade de TI da pessoa e guiá-la até a abertura do chamado certo no Jira.
- Você NÃO resolve o problema técnico nem promete prazos. Seu papel é acolher, triar e encaminhar.

REGRAS DE CONVERSA
- Faça no máximo 2 a 3 perguntas de triagem, uma de cada vez. Só pergunte o que ainda falta.
- Assim que tiver clareza da categoria, encaminhe (acao = "enviar_link").
- Se a pessoa pedir para falar com um atendente humano, ou se você não entender após 2 tentativas, use acao = "escalar_humano".
- Se o assunto claramente não for de suporte de TI, use acao = "fora_escopo" e oriente educadamente.
- Enquanto ainda estiver coletando informação, use acao = "continuar".

CATEGORIAS POSSÍVEIS (campo "categoria")
- acesso_senha: login, senha expirada/incorreta, conta bloqueada, e-mail não abre
- acesso_privilegiado: pedido de acesso de administrador/privilegiado
- hardware: equipamento com defeito (pc, monitor, teclado, mouse, impressora)
- equipamento: pedido de um novo equipamento
- software: instalar programa, solicitar licença de software
- email: problemas de e-mail
- rede_internet: internet/rede caindo ou lenta
- incidente: sistema fora do ar, parada, urgência que afeta o trabalho agora
- onboarding: novo colaborador precisa de acessos/equipamentos
- outros: dúvida genérica de TI

SAÍDA — responda SOMENTE com um JSON válido, sem texto fora do JSON, neste formato:
{
  "resposta_cliente": "string, a mensagem a enviar no WhatsApp",
  "categoria": "uma das categorias acima ou null se ainda não sabe",
  "urgencia": "baixa | media | alta",
  "acao": "continuar | enviar_link | escalar_humano | fora_escopo"
}

IMPORTANTE
- Quando acao = "enviar_link", NÃO escreva o link você mesmo na resposta_cliente; o sistema anexa o link certo automaticamente. Apenas diga algo como "já vou te passar o formulário certo pra abrir o chamado".
- Nunca invente números de chamado, prazos ou soluções técnicas arriscadas.`;

export async function orchestrate(history) {
  if (PROVIDER === "openai") return orchestrateOpenAI(history);
  return orchestrateAnthropic(history);
}

async function orchestrateAnthropic(history) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const resp = await client.messages.create({
    model,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });
  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return parseJson(text);
}

async function orchestrateOpenAI(history) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const resp = await client.chat.completions.create({
    model,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ],
  });
  const text = (resp.choices?.[0]?.message?.content || "").trim();
  return parseJson(text);
}

function parseJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  try {
    const obj = JSON.parse(match ? match[0] : text);
    return {
      resposta_cliente:
        obj.resposta_cliente ||
        "Desculpe, tive um probleminha aqui. Pode repetir o que você precisa?",
      categoria: obj.categoria || null,
      urgencia: obj.urgencia || "baixa",
      acao: obj.acao || "continuar",
    };
  } catch {
    return {
      resposta_cliente:
        "Desculpe, não consegui entender bem. Pode me explicar com outras palavras o que está acontecendo?",
      categoria: null,
      urgencia: "baixa",
      acao: "continuar",
    };
  }
}
