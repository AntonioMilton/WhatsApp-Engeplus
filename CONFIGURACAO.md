# Guia de Configuração — WhatsApp Cloud API + Servidor

Passo a passo de onde e como configurar tudo. Siga na ordem. No fim, o `.env` estará
preenchido e o webhook conectado.

> Dica: você pode começar com o **número de teste gratuito** que a Meta cria
> automaticamente (funciona na hora, sem verificação) e só depois plugar o número real
> **+55 47 9693-0617** (que exige verificação do negócio). Recomendo testar primeiro.

---

## Parte 1 — Conta e app na Meta

**Onde:** https://developers.facebook.com

1. Clique em **Get Started / Começar** e entre com sua conta do Facebook. Confirme o
   cadastro (OTP + dados). Isso cria sua conta de desenvolvedor.
2. Vá em **My Apps → Create App** (Criar aplicativo).
3. Tipo do app: escolha **Business**.
4. Dê um nome (ex.: "Suporte TI Engeplus") e crie.
5. No painel do app, em **Add products**, adicione o produto **WhatsApp**.

## Parte 2 — Pegar os dados de teste

**Onde:** dentro do app → menu lateral **WhatsApp → API Setup / Configuração da API**

Nessa tela você vê e copia:

- **Phone number ID** → vai no `.env` como `WHATSAPP_PHONE_NUMBER_ID`
  (é um número longo; **não** é o telefone).
- **WhatsApp Business Account ID (WABA ID)** → guarde para depois.
- **Temporary access token** (botão *Generate access token*) → serve só para teste
  (expira em 24h). Vai no `.env` como `WHATSAPP_TOKEN` **por enquanto**.
- Em **To**, adicione o **seu** celular como número de destino de teste (recebe um código
  de verificação no WhatsApp). Assim você consegue trocar mensagens de teste.

## Parte 3 — App Secret

**Onde:** app → **App settings → Basic / Configurações → Básico**

- Copie o **App Secret** (clique em *Show*) → `.env` como `META_APP_SECRET`.
  (É o que o servidor usa para validar que o webhook veio mesmo da Meta.)

## Parte 4 — Token permanente (para produção)

O token temporário morre em 24h. Para produção, crie um **System User**:

**Onde:** https://business.facebook.com → **Business Settings → Users → System Users**

1. Crie um System User (tipo *Admin* ou *Employee*).
2. Em **Add Assets**, dê a ele acesso ao **app** do WhatsApp (permissão total).
3. Clique em **Generate new token**, escolha o app, marque as permissões
   `whatsapp_business_messaging` e `whatsapp_business_management`.
4. Copie o token gerado (esse **não expira**) → substitua `WHATSAPP_TOKEN` no `.env`.

## Parte 5 — Chave da IA (Claude)

**Onde:** https://console.anthropic.com → **API Keys**

- Crie uma chave e copie → `.env` como `ANTHROPIC_API_KEY`.

## Parte 6 — Rodar o servidor

No terminal, dentro da pasta do projeto:

```
npm install
cp .env.example .env      # (Windows PowerShell: copy .env.example .env)
# edite o .env com os valores das partes anteriores
npm start
```

Deve aparecer: `[server] ouvindo na porta 3000`.

## Parte 7 — Expor por HTTPS (webhook precisa ser público)

A Meta só aceita URL **HTTPS pública**. Em desenvolvimento, use o **ngrok**:

**Onde:** https://ngrok.com (crie conta grátis, baixe, autentique com seu token)

```
ngrok http 3000
```

Ele te dá uma URL tipo `https://abcd-1234.ngrok-free.app`. Sua Callback URL será
`https://abcd-1234.ngrok-free.app/webhook`.

> Para produção (24/7), em vez do ngrok use uma hospedagem: **Render**, **Railway**,
> **Fly.io** (opções fáceis e baratas) ou uma VPS. Todas dão HTTPS. Aí a Callback URL é
> o domínio do serviço + `/webhook`.

## Parte 8 — Conectar o webhook na Meta

**Onde:** app → **WhatsApp → Configuration / Configuração → Webhook**

1. Clique em **Edit**.
2. **Callback URL**: `https://SEU_DOMINIO/webhook`
3. **Verify token**: o mesmo texto que você pôs em `WHATSAPP_VERIFY_TOKEN` no `.env`
   (você inventa esse valor, ex.: `engeplus-suporte-2026`).
4. Clique em **Verify and save**. Deve dar certo (o servidor responde ao desafio).
5. Em **Webhook fields**, clique em **Manage** e assine o campo **messages**.

## Parte 9 — Testar ponta a ponta

1. Com servidor + ngrok rodando e webhook conectado, mande uma mensagem do **seu celular
   de teste** para o número de teste da Meta.
2. O bot deve responder, fazer a triagem e mandar o link do portal SUP.

## Parte 10 — Colocar o número real +55 47 9693-0617

Quando o teste estiver ok:

1. Faça a **verificação do negócio** (Business Verification) em
   https://business.facebook.com → Security Center. (Pode pedir documentos da empresa.)
2. Em **WhatsApp → API Setup → Add phone number**, adicione o **+55 47 9693-0617**.
   ⚠️ O número **não pode** estar ativo no app WhatsApp/WhatsApp Business comum — se
   estiver, é preciso removê-lo de lá antes.
3. Verifique o número por SMS/ligação. Pronto, ele passa a ser o `WHATSAPP_PHONE_NUMBER_ID`
   de produção.

---

### Resumo do que vai no `.env`

| Variável | De onde vem |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Parte 2 (API Setup) |
| `WHATSAPP_TOKEN` | Parte 2 (teste) → Parte 4 (permanente) |
| `META_APP_SECRET` | Parte 3 (App settings → Basic) |
| `WHATSAPP_VERIFY_TOKEN` | você inventa (usa igual na Parte 8) |
| `ANTHROPIC_API_KEY` | Parte 5 (console.anthropic.com) |
| `JIRA_PORTAL_BASE` | já preenchido (portal SUP) |

### Fontes
- [WhatsApp Cloud API — Get Started (Meta oficial)](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- [About the WhatsApp Business Platform (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform)
