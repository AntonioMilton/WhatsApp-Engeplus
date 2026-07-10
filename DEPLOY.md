# Deploy no servidor Engeplus (serviço separado + subdomínio)

Cenário: Ubuntu + Nginx + PM2 já rodando no servidor `erp-api.engeplus.eng.br`.
O bot vai como **serviço separado** do ERP, com repositório próprio, pasta
`/var/www/whatsapp-suporte`, processo PM2 próprio e um **subdomínio novo**.

- Subdomínio sugerido: **`suporte-wa.engeplus.eng.br`** (troque se preferir)
- Callback final na Meta: **`https://suporte-wa.engeplus.eng.br/webhook`**

> Segurança: recomendo migrar o deploy para **chave SSH** (em vez da senha de root no
> `deploy.sh`) e **trocar a senha de root**. O `deploy.sh` já está no `.gitignore`, então
> não vazou no Git — mas senha em arquivo é risco. Chave SSH resolve isso.

---

## 1. Criar o repositório Git do bot (no seu PC)

Dentro da pasta do projeto, no seu computador:
```bash
git init
git add .
git commit -m "MVP webhook WhatsApp -> Jira (Estratégia A)"
# crie um repo vazio no GitHub/GitLab/Bitbucket (ou no seu Git interno) e:
git remote add origin URL_DO_SEU_REPO.git
git push -u origin main
```
> O `.env` **não** vai pro Git (já está no `.gitignore`). Os segredos você cria direto no
> servidor no passo 4.

## 2. DNS do subdomínio

No painel de DNS do domínio `engeplus.eng.br`, crie um registro:
```
Tipo: A
Nome: suporte-wa
Valor: <IP público do servidor erp-api.engeplus.eng.br>
```
Espere propagar (checar com `ping suporte-wa.engeplus.eng.br` ou `dig`).

## 3. Clonar no servidor

Conecte no servidor (`ssh root@erp-api.engeplus.eng.br`) e:
```bash
cd /var/www
git clone URL_DO_SEU_REPO.git whatsapp-suporte
cd whatsapp-suporte
node -v          # precisa ser >= 20
npm install
```

## 4. Criar o `.env` no servidor

```bash
cp .env.example .env
nano .env
```
Preencha (use uma **porta livre** — veja o passo 5):
```
WHATSAPP_TOKEN=...              # token da Meta
WHATSAPP_PHONE_NUMBER_ID=1161833617020228
WHATSAPP_VERIFY_TOKEN=engeplus-suporte-2026
META_APP_SECRET=...             # Configurações do app -> Básico (ou vazio no 1º teste)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5
PORT=3001
JIRA_PORTAL_BASE=https://ti-petkov.atlassian.net/servicedesk/customer/portal/1
```

## 5. Escolher porta livre

O backend do ERP pode já usar a 3000. Verifique e escolha outra se preciso:
```bash
sudo ss -ltnp | grep -E ':3000|:3001|:3002'
```
Use a porta livre no `.env` (`PORT=`) e no Nginx (passo 7). O exemplo usa **3001**.

## 6. Subir com PM2

```bash
pm2 start src/server.js --name whatsapp-suporte
pm2 save
pm2 logs whatsapp-suporte      # deve mostrar: [server] ouvindo na porta 3001
```
(O `pm2 startup` provavelmente já está configurado por causa do ERP.)

## 7. Nginx — novo server block do subdomínio

Crie `/etc/nginx/sites-available/suporte-wa`:
```nginx
server {
    listen 80;
    server_name suporte-wa.engeplus.eng.br;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Ative e recarregue:
```bash
sudo ln -s /etc/nginx/sites-available/suporte-wa /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
> Ajuste a porta `3001` se você escolheu outra no passo 5.

## 8. HTTPS com Certbot (Let's Encrypt)

```bash
sudo certbot --nginx -d suporte-wa.engeplus.eng.br
```
O Certbot pega o certificado e adiciona o bloco `443 ssl` automaticamente (aceite o
redirecionamento HTTP→HTTPS quando ele perguntar). Se `certbot` não estiver instalado:
```bash
sudo apt install -y certbot python3-certbot-nginx
```

## 9. Testar o webhook (antes da Meta)

```bash
curl "https://suporte-wa.engeplus.eng.br/webhook?hub.mode=subscribe&hub.verify_token=engeplus-suporte-2026&hub.challenge=teste123"
```
Tem que retornar exatamente: `teste123`. ✅

## 10. Configurar na Meta (Etapa 2 → Configurar webhooks)

- **URL de callback**: `https://suporte-wa.engeplus.eng.br/webhook`
- **Verificar token**: `engeplus-suporte-2026`
- **Verificar e salvar** → depois assine (**Subscribe**) o campo **messages**.

## 11. Teste ponta a ponta

Mande mensagem do seu celular de teste para o número de teste da Meta. Acompanhe:
```bash
pm2 logs whatsapp-suporte
```
O bot responde, faz a triagem e envia o link do portal SUP.

---

## Deploys futuros (atualizar o bot)

Igual ao padrão do ERP:
```bash
cd /var/www/whatsapp-suporte && git pull && npm install && pm2 restart whatsapp-suporte
```

### Comandos úteis do PM2
```bash
pm2 restart whatsapp-suporte    # após mudar .env ou código
pm2 stop whatsapp-suporte
pm2 logs whatsapp-suporte --lines 100
```
