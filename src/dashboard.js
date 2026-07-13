// Página HTML do painel de monitoramento (single-file, sem dependências externas).

export const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Painel de Atendimento — Suporte TI</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#0f172a; color:#e2e8f0; }
  header { padding:14px 20px; background:#1e293b; border-bottom:1px solid #334155; display:flex; align-items:center; justify-content:space-between; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  header .meta { font-size:12px; color:#94a3b8; }
  .wrap { display:flex; height:calc(100vh - 51px); }
  .list { width:340px; border-right:1px solid #334155; overflow-y:auto; }
  .item { padding:12px 16px; border-bottom:1px solid #1e293b; cursor:pointer; }
  .item:hover { background:#1e293b; }
  .item.active { background:#243045; }
  .item .top { display:flex; justify-content:space-between; gap:8px; }
  .item .name { font-weight:600; font-size:14px; }
  .item .time { font-size:11px; color:#94a3b8; white-space:nowrap; }
  .item .last { font-size:12px; color:#94a3b8; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .badge { display:inline-block; font-size:10px; padding:2px 7px; border-radius:10px; margin-top:6px; margin-right:5px; }
  .badge.cat { background:#334155; color:#cbd5e1; }
  .badge.human { background:#b91c1c; color:#fff; font-weight:600; }
  .col { flex:1; display:flex; flex-direction:column; }
  .thread { flex:1; overflow-y:auto; padding:20px; }
  .empty { color:#64748b; text-align:center; margin-top:60px; }
  .msg { max-width:70%; padding:9px 13px; border-radius:12px; margin-bottom:10px; font-size:14px; line-height:1.35; white-space:pre-wrap; word-wrap:break-word; }
  .msg.in { background:#334155; }
  .msg.out { background:#166534; margin-left:auto; }
  .msg .m-time { display:block; font-size:10px; color:#cbd5e1a0; margin-top:4px; }
  .thread h2 { font-size:15px; margin:0 0 4px; }
  .thread .sub { font-size:12px; color:#94a3b8; margin-bottom:18px; }
  .warn { background:#78350f; color:#fde68a; font-size:12px; padding:8px 12px; border-radius:8px; margin-bottom:10px; }
  .composer { border-top:1px solid #334155; padding:12px 16px; display:flex; gap:10px; align-items:flex-end; background:#111827; }
  .composer textarea { flex:1; resize:vertical; min-height:44px; max-height:160px; padding:10px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#e2e8f0; font-family:inherit; font-size:14px; }
  .composer button { padding:10px 16px; border:0; border-radius:8px; background:#2563eb; color:#fff; font-weight:600; cursor:pointer; }
  .composer button:disabled { opacity:.6; cursor:default; }
  .btn-sec { background:#475569 !important; font-size:12px; padding:6px 10px !important; }
  #alerts { border-bottom:1px solid #334155; background:#1c1917; max-height:180px; overflow-y:auto; }
  .alert-item { padding:8px 20px; border-bottom:1px solid #292524; font-size:12px; }
  .alert-item .a-head { color:#fbbf24; font-weight:600; }
  .alert-item .a-msg { color:#e7e5e4; margin-top:2px; white-space:pre-wrap; }
  .alert-item .a-reason { color:#a8a29e; margin-top:2px; }
</style>
</head>
<body>
<header>
  <h1>Painel de Atendimento — Suporte TI</h1>
  <span class="meta" id="meta">carregando…</span>
</header>
<div id="alerts"></div>
<div class="wrap">
  <div class="list" id="list"></div>
  <div class="col">
    <div class="thread" id="thread"><div class="empty">Selecione uma conversa à esquerda.</div></div>
    <div id="composer"></div>
  </div>
</div>
<script>
let convs = [];
let selected = null;

function fmtTime(ts){ if(!ts) return ""; const d=new Date(ts); return d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
function esc(s){ return (s||"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c])); }

async function refresh(){
  try{
    const r = await fetch("/admin/api/conversations", { headers:{ "Accept":"application/json" } });
    if(!r.ok) throw new Error(r.status);
    convs = await r.json();
    renderList();
    renderThread(convs.find(c=>c.phone===selected));
    const humanos = convs.filter(c=>c.escalated).length;
    document.getElementById("meta").textContent = convs.length + " conversas · " + humanos + " em atendimento humano";
    await refreshAlerts();
  }catch(e){ document.getElementById("meta").textContent = "erro ao carregar ("+e.message+")"; }
}

async function refreshAlerts(){
  try{
    const r = await fetch("/admin/api/alerts", { headers:{ "Accept":"application/json" } });
    if(!r.ok) return;
    const alerts = await r.json();
    const el = document.getElementById("alerts");
    if(!alerts.length){ el.innerHTML=""; return; }
    el.innerHTML = alerts.slice(0,20).map(a=>
      '<div class="alert-item">'
      + '<div class="a-head">🔔 '+fmtTime(a.ts)+' · '+esc(a.name||a.phone)+(a.ticket?' · '+esc(a.ticket):'')+'</div>'
      + '<div class="a-msg">'+esc(a.message)+'</div>'
      + (a.reason?'<div class="a-reason">'+esc(a.reason)+'</div>':'')
      + '</div>').join("");
  }catch(e){ /* silencioso */ }
}

function renderList(){
  const el = document.getElementById("list");
  el.innerHTML = convs.map(c=>{
    const last = c.messages && c.messages.length ? c.messages[c.messages.length-1] : null;
    const lastCat = [...(c.messages||[])].reverse().find(m=>m.categoria);
    return '<div class="item '+(c.phone===selected?'active':'')+'" onclick="select(\\''+c.phone+'\\')">'
      + '<div class="top"><span class="name">'+esc(c.name||c.phone)+'</span><span class="time">'+fmtTime(c.updatedAt)+'</span></div>'
      + '<div class="last">'+esc(last?last.text:"")+'</div>'
      + (c.escalated?'<span class="badge human">atendimento humano</span>':'')
      + (lastCat?'<span class="badge cat">'+esc(lastCat.categoria)+'</span>':'')
      + '</div>';
  }).join("") || '<div class="empty" style="margin-top:30px">Nenhuma conversa ainda.</div>';
}

function renderThread(c){
  const el = document.getElementById("thread");
  const comp = document.getElementById("composer");
  if(!c){ el.innerHTML='<div class="empty">Selecione uma conversa.</div>'; comp.innerHTML=""; return; }
  const msgs = (c.messages||[]).map(m=>'<div class="msg '+m.dir+'">'+esc(m.text)+'<span class="m-time">'+fmtTime(m.ts)+'</span></div>').join("");
  el.innerHTML = '<h2>'+esc(c.name||c.phone)+'</h2><div class="sub">'+esc(c.phone)+(c.escalated?' · <b style="color:#f87171">atendimento humano (bot pausado)</b>':' · bot ativo')+'</div>'+msgs;
  el.scrollTop = el.scrollHeight;

  const lastIn = [...(c.messages||[])].reverse().find(m=>m.dir==="in");
  const withinWindow = lastIn && (Date.now()-lastIn.ts) < 24*3600*1000;
  const warn = withinWindow ? "" : '<div class="warn" style="width:100%">⚠️ Fora da janela de 24h. Uma resposta simples pode ser recusada pela Meta (exigiria um template aprovado).</div>';
  const reactivate = c.escalated ? '<button class="btn-sec" onclick="reactivate(\\''+c.phone+'\\')">Reativar bot</button>' : '';
  comp.innerHTML = warn
    + '<div class="composer"><textarea id="replyText" placeholder="Escreva uma resposta..."></textarea>'
    + reactivate
    + '<button id="sendBtn" onclick="sendReply(\\''+c.phone+'\\')">Enviar</button></div>';
}

function select(phone){ selected = phone; renderList(); renderThread(convs.find(c=>c.phone===phone)); }

async function sendReply(phone){
  const ta = document.getElementById("replyText");
  const text = (ta.value||"").trim();
  if(!text) return;
  const btn = document.getElementById("sendBtn");
  btn.disabled = true; btn.textContent = "Enviando...";
  try{
    const r = await fetch("/admin/api/reply", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ phone, text }) });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || r.status);
    ta.value = "";
    await refresh();
  }catch(e){ alert("Falha ao enviar: "+e.message); }
  finally{ btn.disabled = false; btn.textContent = "Enviar"; }
}

async function reactivate(phone){
  if(!confirm("Reativar o bot para esta conversa? O assistente volta a responder automaticamente.")) return;
  try{
    await fetch("/admin/api/reactivate", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ phone }) });
    await refresh();
  }catch(e){ alert("Falha: "+e.message); }
}

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;
