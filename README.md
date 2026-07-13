# WhatsApp Suporte de TI → Jira (Service Desk N1 completo)

Assistente de atendimento no WhatsApp usando a **Meta Cloud API oficial**. Quando alguém
manda mensagem no número **+55 47 9693-0617**, um assistente de IA atua como um
**analista de suporte de primeiro nível (N1)** e conduz o atendimento inteiro:

1. **Recepção** — cumprimenta e identifica se é atendimento novo ou continuação de chamado.
2. **Entendimento** — conversa naturalmente e coleta nome, telefone, categoria, o que foi
   afetado, sintomas, mensagens de erro, passos, início, usuários afetados, impacto e urgência.
3. **Validação** — apresenta um resumo ("Entendi. Seu problema é o seguinte...") e só segue
   após a confirmação do usuário.
4. **Abertura automática no Jira** — cria o ticket no projeto **SUP** via API (tipo, categoria,
   request type do portal, prioridade e responsável corretos) e informa o número (ex.: SUP-123).
5. **Acompanhamento** — um monitor consulta o Jira periodicamente e avisa o usuário em
   linguagem simples a cada mudança relevante (triagem, em atendimento, aguardando, em
   testes, resolvido, fechado, reaberto).
6. **Informações adicionais** — se o técnico comentar pedindo algo, o assistente repassa a
   pergunta no WhatsApp, coleta a resposta e registra como comentário no ticket.
7. **Encerramento** — quando resolvido, apresenta a solução e pede confirmação: confirmou,
   fecha o ticket; não confirmou, **reabre automaticamente** com o novo relato.
8. **Nova conversa** — após o encerramento, a próxima mensagem inicia um novo atendimento.

O usuário nunca precisa acessar o Jira — o assistente é a interface única.

## Arquitetura

```
Cliente (WhatsApp) ⇄ Meta Cloud API ⇄ src/server.js (webhook + máquina de estados)
                                          │
                    src/ai.js (analista N1 — Claude/GPT, saída JSON)
                    src/jira.js (REST v3: criar, comentar, transicionar)
                    src/monitor.js (polling do ciclo de vida → notificações)
                    src/store.js (data/store.json: conversas, tickets, alertas, fila)
                    src/session.js (histórico em memória, reidratado do store)
                    src/dashboard.js (painel /admin + alertas do operador)
```

### Fases do atendimento (controladas pelo servidor)

| Fase | O que acontece | Ações da IA aceitas |
|---|---|---|
| `triagem` | entendimento do problema | continuar, validar, criar_chamado, escalar_humano, fora_escopo |
| `validacao` | resumo apresentado, aguarda confirmação | continuar, validar, criar_chamado, escalar_humano, fora_escopo |
| `acompanhamento` | ticket aberto, monitor ativo | continuar, atualizar_chamado, encerrar, escalar_humano |
| `resolucao` | resolvido, aguarda confirmação do usuário | continuar, atualizar_chamado, encerrar, reabrir, escalar_humano |

A IA propõe a ação; o servidor valida contra a fase (ações fora da fase viram `continuar`).

### Mapeamento no Jira (projeto SUP — ti-petkov.atlassian.net)

| Categoria da IA | Tipo de item | Request type (portal) |
|---|---|---|
| incidente / rede_internet | [System] Incident | Reportar Incidente |
| hardware | [System] Incident | Reportar Falha em Hardware |
| acesso_senha / email | [System] Service request | Solicitar Acesso ao Sistema |
| acesso_privilegiado | [System] Service request | Solicitar Acesso Privilegiado |
| software | [System] Service request | Solicitar Software ou Licença |
| equipamento | [System] Service request | Solicitar Equipamento |
| onboarding | [System] Service request | Integração de Novo Colaborador |
| outros | [System] Service request | Solicitar Suporte de TI |

Urgência → prioridade: crítica→Highest, alta→High, média→Medium, baixa→Low (+ campo
Urgency do JSM). Responsável padrão: AntonioMilton (`JIRA_ASSIGNEE_ACCOUNT_ID`).
Se algum campo do JSM for recusado na criação, o bot tenta payloads progressivamente
mais simples — a abertura do chamado nunca fica bloqueada por campo opcional.

## Janela de 24h da Meta

Notificações proativas (mudança de status) fora da janela de 24h são rejeitadas pela Meta.
Nesse caso o bot: (1) guarda a mensagem e entrega quando o usuário escrever de novo, e
(2) gera um **alerta para o operador** no painel `/admin` (e no log) com o texto pronto
para envio manual por outro meio.

## Setup

1. `npm install`
2. Copie `.env.example` para `.env` e preencha:
   - `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`
   - `ANTHROPIC_API_KEY` (ou `OPENAI_API_KEY` com `AI_PROVIDER=openai`)
   - `JIRA_EMAIL` + `JIRA_API_TOKEN` (token em id.atlassian.com → Security → API tokens)
3. `npm start`
4. Exponha o servidor por HTTPS público (dev: `ngrok http 3002`) e configure o webhook na Meta
   (Callback `https://SEU_DOMINIO/webhook`, verify token igual ao `.env`, campo **messages**).

## Testes

`npm test` roda a suíte ponta a ponta com Meta/Jira/IA simulados (35 verificações):
fluxo completo de abertura, acompanhamento, pergunta do técnico, resolução, encerramento,
reabertura, janela de 24h, escalada para humano, fallbacks de criação e falha do Jira.

## Painel do operador

`/admin` (Basic Auth: `ADMIN_USER`/`ADMIN_PASS`): conversas em tempo real, resposta manual
(pausa o bot para aquele contato), reativação do bot e **alertas do operador** no topo
(notificações que precisam de envio manual, falhas de integração, pedidos de humano).
