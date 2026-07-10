# WhatsApp Suporte de TI → Jira (Estratégia A)

Bot de atendimento no WhatsApp usando a **Meta Cloud API oficial**. Quando um cliente
manda mensagem no número **+55 47 9693-0617**, um assistente de IA (Claude) responde de
forma natural, faz a triagem e envia o **link do tipo de solicitação correto** no portal
do Jira Service Management (projeto **SUP – Central de Suporte de TI**).

> **Estratégia A**: o bot conversa e entrega o link do portal. O próprio cliente preenche
> e o chamado entra na fila com os SLAs e automações nativas do Jira. (A criação
> automática via API — Estratégia B — fica para uma fase futura.)

## Como funciona

1. Cliente manda mensagem → Meta Cloud API chama o `POST /webhook`.
2. O servidor responde `200 OK` na hora e processa em background.
3. O histórico vai para o Claude (`src/ai.js`), que devolve JSON: resposta natural +
   categoria + ação.
4. Se a ação for `enviar_link`, o servidor anexa o link certo (`src/jira-links.js`).
5. A resposta é enviada de volta pela Cloud API (`src/whatsapp.js`).

Como o cliente **inicia** a conversa, as respostas dentro da **janela de 24h são
gratuitas** — não há custo de mensagem.

## Estrutura

```
src/
  server.js       webhook (verificação + recebimento) e orquestração
  whatsapp.js     envio de mensagens e parse do payload da Meta
  ai.js           orquestrador Claude + system prompt de triagem
  jira-links.js   mapa categoria -> link do portal SUP (portal id = 1)
  session.js      estado da conversa em memória (trocar por Redis em produção)
```

## Tipos de solicitação mapeados (portal SUP)

| Categoria da IA        | Tipo no portal                  | Link |
|------------------------|----------------------------------|------|
| acesso_senha / email   | Solicitar Acesso ao Sistema      | .../create/3 |
| acesso_privilegiado    | Solicitar Acesso Privilegiado    | .../create/2 |
| hardware               | Reportar Falha em Hardware       | .../create/7 |
| equipamento            | Solicitar Equipamento            | .../create/9 |
| software               | Solicitar Software ou Licença    | .../create/4 |
| rede_internet / incidente | Reportar Incidente            | .../create/6 |
| onboarding             | Integração de Novo Colaborador   | .../create/8 |
| outros                 | Solicitar Suporte de TI          | .../create/1 |

Base: `https://ti-petkov.atlassian.net/servicedesk/customer/portal/1`

## Setup

1. `npm install`
2. Copie `.env.example` para `.env` e preencha:
   - `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`
     (do painel *Meta for Developers* → app → WhatsApp).
   - `ANTHROPIC_API_KEY` (e opcional `ANTHROPIC_MODEL`).
3. `npm start` (sobe na porta 3000).
4. Exponha o servidor por HTTPS público. Em desenvolvimento, use `ngrok http 3000`.
5. No painel da Meta, configure o webhook:
   - **Callback URL**: `https://SEU_DOMINIO/webhook`
   - **Verify token**: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
   - Inscreva-se no campo **messages**.

## Testar sem a Meta

Verificação do webhook:
```
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=123"
# deve retornar: 123
```

## Próximos passos (fases seguintes)

- **Fila assíncrona** (BullMQ/Redis) para picos de mensagens.
- **Notificar a equipe** quando `acao = escalar_humano` (e-mail/Slack/comentário no Jira).
- **Mídia**: baixar imagens/áudios da Meta e anexar ao chamado.
- **Estratégia B**: criar o chamado direto via API do Jira e devolver o nº (SUP-XXX).
- **Template de utilidade** aprovado para reabrir conversa após 24h, se necessário.
