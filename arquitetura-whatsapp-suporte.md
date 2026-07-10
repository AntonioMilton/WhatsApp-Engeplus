# Automação de Atendimento WhatsApp → Jira (Suporte de TI)

**Documento de Arquitetura e Plano de Implementação**
Engeplus · Central de Suporte de TI
Autor: Antonio Milton · Data: 10/07/2026 · Versão 1.0 (rascunho)

---

## 1. Objetivo

Automatizar o atendimento do WhatsApp através da **API Oficial (Meta WhatsApp Cloud API)**. Quando um cliente/colaborador entrar em contato pelo número **+55 47 9693-0617**, um assistente de IA responde de forma **natural e conversacional** e, ao longo da conversa, **guia a pessoa até o link correto** para abrir um chamado de suporte de TI no **Jira** (projeto *Central de Suporte de TI*, chave **SUP**).

A IA não substitui o Jira — ela **entende o problema, classifica** e **encaminha para o formulário certo**, reduzindo chamados mal categorizados e fricção para o solicitante.

---

## 2. Por que a opção gratuita da Meta atende bem este caso

O caso de uso é **100% iniciado pelo cliente** (a pessoa manda mensagem primeiro pedindo suporte). Isso é decisivo para o custo:

- Desde **novembro/2024**, as **conversas de serviço** (iniciadas pelo cliente) são **gratuitas e ilimitadas**.
- Quando o cliente envia uma mensagem, abre-se uma **janela de atendimento de 24 horas**. Dentro dessa janela, todas as respostas do negócio são **de graça**. A janela **reinicia** a cada nova mensagem do cliente.
- Desde **01/07/2025** o modelo mudou de "por conversa" para **cobrança por mensagem**, mas isso só afeta mensagens **iniciadas pelo negócio** (marketing, utilidade, autenticação) — que **não** são o foco aqui.

**Conclusão:** para responder e guiar quem já iniciou o contato, o custo de mensagens é **zero** dentro da janela de 24h. Só haveria custo se você quisesse **reabrir** proativamente uma conversa passadas 24h (aí seria necessário um *template* de utilidade, com custo baixo por mensagem).

A "opção gratuita" da Cloud API refere-se ao acesso à API em si (sem mensalidade da Meta) + as conversas de serviço gratuitas. O que você precisa hospedar por conta própria é o **webhook/servidor** que processa as mensagens.

---

## 3. Visão geral da arquitetura

```
   Cliente (WhatsApp)
          │  mensagem
          ▼
   Meta WhatsApp Cloud API  ──────────────►  (envio de respostas de volta)
          │  webhook (HTTPS, POST)                     ▲
          ▼                                            │
   ┌─────────────────────────────────────────────┐    │
   │        Servidor de Integração (backend)       │    │
   │                                               │    │
   │  1. Recebe/valida webhook (assinatura Meta)   │    │
   │  2. Gerencia estado da conversa (sessão)      │    │
   │  3. Orquestrador de IA (Claude)  ─────────────┼────┘
   │     - interpreta a mensagem                   │
   │     - responde de forma natural               │
   │     - classifica o tipo de chamado            │
   │  4. Monta o link/portal Jira correto          │
   │  5. (opcional) Cria o chamado via Jira API    │
   └───────────────┬───────────────────────────────┘
                   │
                   ▼
        Jira Service Management (projeto SUP)
        Portal de cliente + tipos de solicitação
```

### Componentes

**a) Meta WhatsApp Cloud API** — recebe as mensagens dos clientes e entrega respostas. Configurada no *Meta for Developers* + *WhatsApp Business Platform*. Exige um número verificado (o +55 47 9693-0617) e um **webhook HTTPS**.

**b) Servidor de integração (o que precisa ser desenvolvido)** — um backend leve (ex.: Node.js/Express, Python/FastAPI) que:
- expõe o endpoint do webhook (verificação via *verify token* + validação da assinatura `X-Hub-Signature-256`);
- responde `200 OK` em **menos de 5 segundos** (a Meta desativa o webhook após 5 falhas consecutivas) — o processamento pesado deve ser **assíncrono** (fila);
- mantém o **estado da conversa** por número (Redis ou banco leve);
- chama o **orquestrador de IA**;
- decide qual **link do Jira** enviar (ou cria o chamado direto via API).

**c) Orquestrador de IA (Claude)** — recebe a mensagem + histórico da conversa e um *system prompt* com as regras de atendimento. Retorna: (1) o texto natural de resposta ao cliente e (2) uma **classificação estruturada** do chamado (categoria, urgência, dados coletados). Recomenda-se saída em JSON para a lógica ler com segurança.

**d) Jira Service Management (SUP)** — destino final. Duas estratégias possíveis (ver seção 5).

---

## 4. Fluxo de conversa (IA guiando ao Jira)

Princípio: **conversar como uma pessoa da equipe de suporte**, coletar o mínimo necessário e então entregar o link certo (ou abrir o chamado). Sem menus rígidos numerados — a IA interpreta texto livre.

**Exemplo de diálogo:**

> **Cliente:** oi, meu e-mail não abre desde cedo
> **Bot:** Oi! Poxa, que chato começar o dia assim. Deixa eu te ajudar 🙂 Isso é no computador da empresa ou no celular? E aparece alguma mensagem de erro?
> **Cliente:** no pc, diz senha incorreta mas não mudei nada
> **Bot:** Entendi — parece bloqueio/expiração de senha. Isso a gente resolve rapidinho abrindo um chamado de *Acesso e Senhas*. Já deixei o formulário pré-preenchido pra você, é só confirmar aqui: [link do portal]. Qualquer coisa me chama que acompanho por aqui.

**Etapas internas do fluxo:**

1. **Recepção** — saudação natural + primeira pergunta de triagem (só se necessário).
2. **Triagem por IA** — a IA identifica a **categoria** do problema. Sugestão de categorias mapeadas para o Jira: *Acesso/Senha*, *Hardware/Equipamento*, *Software/Sistemas*, *Rede/Internet*, *E-mail*, *Incidente (parada/urgência)*, *Solicitação de serviço (novo acesso, nova máquina)*, *Outros*.
3. **Coleta mínima** — nome, setor/unidade, descrição curta, e se é urgente (afeta o trabalho agora?). A IA só pergunta o que ainda falta.
4. **Encaminhamento** — a IA envia o **link do tipo de solicitação correto** no portal do Jira, com uma frase amigável. Opcionalmente, já cria o chamado e devolve o **número (ex.: SUP-123)** para acompanhamento.
5. **Fallback humano** — se a IA não entender após 2 tentativas, ou se o cliente pedir "falar com atendente", a conversa é sinalizada para um humano assumir (e o bot avisa que alguém vai responder).
6. **Fora do escopo** — se não for TI, a IA educadamente informa e, se aplicável, direciona ao canal certo.

**System prompt (esqueleto sugerido para a IA):**
- Persona: atendente de suporte de TI da Engeplus, cordial, objetivo, PT-BR.
- Objetivo: entender o problema e levar ao chamado certo no Jira — nunca inventar solução técnica arriscada.
- Regras: uma pergunta por vez; no máximo 2–3 perguntas de triagem; sempre terminar entregando link ou nº do chamado; escalar para humano quando pedido ou em caso de incidente crítico.
- Saída: JSON com `resposta_cliente`, `categoria`, `urgencia`, `dados_coletados`, `acao` (`enviar_link` | `criar_chamado` | `escalar_humano` | `fora_escopo`).

---

## 5. Integração com o Jira — duas estratégias

**Site Jira:** `https://ti-petkov.atlassian.net`
**Projeto alvo:** *Central de Suporte de TI* — chave **SUP** (Jira Service Management, com **portal de cliente**).
**Projeto alternativo:** *Hub de suporte* — chave **KAN** (Jira Software; tem os tipos *Incident*, *Service Request*, *Support*).

### Estratégia A — Enviar o link do portal (mais simples, recomendada para o MVP)

O bot envia o **link direto do tipo de solicitação** no portal de cliente do JSM. Formato dos links:

```
Portal geral:   https://ti-petkov.atlassian.net/servicedesk/customer/portals
Um portal:      https://ti-petkov.atlassian.net/servicedesk/customer/portal/{portalId}
Tipo de pedido: https://ti-petkov.atlassian.net/servicedesk/customer/portal/{portalId}/group/{groupId}/create/{requestTypeId}
```

> **Ação necessária:** abrir o portal do projeto SUP, entrar em cada tipo de solicitação e copiar o link real de cada um. Depois é só mapear "categoria da IA → link". Esse mapa fica num arquivo de configuração do servidor.

Vantagens: simples, seguro, o próprio cliente preenche/valida no portal, aproveita SLAs e automações nativas do JSM.

### Estratégia B — Criar o chamado direto via API (experiência mais fluida)

O bot coleta os dados na conversa e **cria o chamado automaticamente** via API do Jira, devolvendo o número (ex.: SUP-123). Pode ser feito com a **JSM Request API** (`POST /rest/servicedeskapi/request`) ou a API de issues. Nesta sessão já há uma conexão Jira disponível que expõe, entre outras, a criação de issues e a consulta de tipos/campos obrigatórios do projeto.

Vantagens: menos passos para o cliente. Cuidado: exige mapear **campos obrigatórios** de cada tipo de solicitação e tratar identificação do solicitante (e-mail). Recomendo **começar pela Estratégia A** e evoluir para a B depois de validado.

---

## 6. Custos estimados

| Item | Custo |
|---|---|
| Acesso à Cloud API (Meta) | Grátis (sem mensalidade) |
| Conversas de serviço (cliente inicia, resposta em ≤24h) | **Grátis / ilimitado** |
| Mensagens iniciadas pelo negócio fora da janela (template utilidade) | Baixo, por mensagem — só se precisar reabrir conversa |
| Hospedagem do servidor/webhook | Baixo (ex.: VPS pequena, ou serverless) |
| API do orquestrador de IA (Claude) | Por uso — poucos tokens por mensagem |
| Jira Service Management | Já contratado (licença existente) |

O custo dominante e recorrente tende a ser **hospedagem + IA**, ambos baixos para volume típico de suporte interno.

---

## 7. Pré-requisitos

1. **Conta Meta Business** verificada (Business Manager).
2. Número **+55 47 9693-0617** disponível para registro na Cloud API (não pode estar ativo no app WhatsApp comum/Business durante o registro).
3. Conta no **Meta for Developers** com um app do tipo *Business* + produto *WhatsApp* adicionado.
4. **Servidor com HTTPS público** (certificado válido) para o webhook.
5. Credenciais do Jira (token de API) e definição do projeto/tipos de solicitação alvo (SUP).
6. Chave de API do provedor de IA (Claude).
7. Definição de **política de dados/LGPD** e mensagem de **opt-in/aviso de privacidade** no primeiro contato.

---

## 8. Plano de implementação (por fases)

**Fase 0 — Setup de contas (0,5–1 dia)**
Criar/validar Meta Business, app no Meta for Developers, registrar o número, gerar token permanente do sistema, e obter token de API do Jira.

**Fase 1 — Webhook mínimo (1–2 dias)**
Servidor que valida a verificação da Meta, valida a assinatura, responde `200 OK` rápido e **ecoa** uma mensagem fixa. Meta: comprovar recebimento/envio ponta a ponta.

**Fase 2 — Estado + orquestrador de IA (2–4 dias)**
Guardar histórico por número; integrar o Claude com o *system prompt*; retornar resposta natural + JSON de classificação. Ainda sem Jira — só conversa fluida e triagem.

**Fase 3 — Encaminhamento ao Jira (Estratégia A) (1–2 dias)**
Mapear categorias → links do portal SUP e enviar o link certo ao fim da triagem. **Este é o MVP entregável** que cumpre o pedido original.

**Fase 4 — Criação automática de chamado (Estratégia B) (2–4 dias, opcional)**
Coletar campos obrigatórios e criar o chamado via API, devolvendo o número SUP-XXX.

**Fase 5 — Robustez e operação (contínuo)**
Fallback humano, fila assíncrona, logs/monitoramento, tratamento de mídia (prints/áudios), mensagens de horário de atendimento, e template de utilidade para reabrir conversas quando necessário.

---

## 9. Considerações importantes

- **Latência do webhook:** processar IA/Jira de forma **assíncrona**; responder à Meta imediatamente para evitar desativação do webhook.
- **Janela de 24h:** se precisar responder após 24h sem nova mensagem do cliente, será necessário um **template aprovado** (categoria utilidade).
- **LGPD/privacidade:** informar, no primeiro contato, que a conversa é atendida por assistente virtual e que os dados serão usados para abertura do chamado; oferecer opção de falar com humano.
- **Segurança:** validar `X-Hub-Signature-256`, guardar tokens em variáveis de ambiente/secret manager, restringir acesso ao servidor.
- **Anti-alucinação:** a IA **não** deve prometer prazos nem dar soluções técnicas arriscadas — seu papel é triar e encaminhar. Guardrails no prompt + validação da saída JSON.
- **Mídia:** clientes mandam prints e áudios; prever download da mídia da Meta e anexar ao chamado (fase posterior).

---

## 10. Próximos passos sugeridos

1. Confirmar a estratégia do MVP: **enviar link do portal (A)** primeiro.
2. Abrir o portal SUP e coletar os **links reais** de cada tipo de solicitação (eu monto o mapa categoria→link).
3. Definir a **stack** do servidor (recomendo Node.js/Express ou Python/FastAPI) e onde hospedar.
4. Escrever o **system prompt** definitivo da IA em conjunto.
5. Iniciar a Fase 0 (setup Meta) em paralelo ao desenvolvimento da Fase 1.

---

### Fontes (pesquisa de pricing/setup da Cloud API, 2026)

- [WhatsApp Business API Pricing 2026 — Uptail](https://www.uptail.ai/blog/whatsapp-business-api-pricing-2026-what-it-costs-and-how-billing-works)
- [WhatsApp Business API Pricing in 2026 — Blueticks](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)
- [WhatsApp Cloud API: Complete Meta Guide — Gurusup](https://gurusup.com/blog/whatsapp-cloud-api)
- [WhatsApp API Pricing 2026 — ChatMaxima](https://chatmaxima.com/whatsapp-api-pricing/)
