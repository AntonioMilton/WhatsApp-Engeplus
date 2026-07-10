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
  .badge { display:inline-block; font-size:10px; padding:2px 7px; border-radius:10px; margin-top:6px; }
  .badge.cat { background:#334155; color:#cbd5e1; }
  .badge.human { background:#b91c1c; color:#fff; font-weight:600; }
  .thread { flex:1; overflow-y:auto; padding:20px; }
  .empty { color:#64748b; text-align:center; margin-top:60px; }
  .msg { max-width:70%; padding:9px 13px; border-radius:12px; margin-bottom:10px; font-size:14px; line-height:1.35; white-space:pre-wrap; word-wrap:break-word; }
  .msg.in { background:#334155; }
  .msg.out { background:#166534; margin-left:auto; }
  .msg .m-time { display:block; font-size:10px; color:#cbd5e1a0; margin-top:4px; }
  .thread h2 { font-size:15px; margin:0 0 4px; }
  .thread .sub { font-size:12px; color:#94a3b8; margin-bottom:18px; }
</style>
</head>
<body>
<header>
  <h1>Painel de Atendimento — Suporte TI</h1>
  <span class="meta" id="meta">carregando…</span>
</header>
<div class="wrap">
  <div class="list" id="list"></div>
  <div class="thread" id="thread"><div class="empty">Selecione uma conversa à esquerda.</div></div>
</div>
<script>
let convs = [];
let selected = null;

function fmtTime(ts){ if(!ts) return ""; const d=new Date(ts); return d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
function esc(s){ return (s||"").replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

async function refresh(){
  try{
    const r = await fetch("/admin/api/conversations", { headers:{ "Accept":"application/json" } });
    if(!r.ok) throw new Error(r.status);
    convs = await r.json();
    renderList();
    if(selected) renderThread(convs.find(c=>c.phone===selected));
    const humanos = convs.filter(c=>c.escalated).length;
    document.getElementById("meta").textContent = convs.length + " conversas · " + humanos + " aguardando humano";
  }catch(e){ document.getElementById("meta").textContent = "erro ao carregar ("+e.message+")"; }
}

function renderList(){
  const el = document.getElementById("list");
  el.innerHTML = convs.map(c=>{
    const last = c.messages && c.messages.length ? c.messages[c.messages.length-1] : null;
    const lastCat = [...(c.messages||[])].reverse().find(m=>m.categoria);
    return \`<div class="item \${c.phone===selected?'active':''}" onclick="select('\${c.phone}')">
      <div class="top"><span class="name">\${esc(c.name||c.phone)}</span><span class="time">\${fmtTime(c.updatedAt)}</span></div>
      <div class="last">\${esc(last?last.text:"")}</div>
      \${c.escalated?'<span class="badge human">aguardando humano</span>':''}
      \${lastCat?'<span class="badge cat">'+esc(lastCat.categoria)+'</span>':''}
    </div>\`;
  }).join("") || '<div class="empty" style="margin-top:30px">Nenhuma conversa ainda.</div>';
}

function renderThread(c){
  const el = document.getElementById("thread");
  if(!c){ el.innerHTML='<div class="empty">Selecione uma conversa.</div>'; return; }
  const msgs = (c.messages||[]).map(m=>\`<div class="msg \${m.dir}">\${esc(m.text)}<span class="m-time">\${fmtTime(m.ts)}</span></div>\`).join("");
  el.innerHTML = \`<h2>\${esc(c.name||c.phone)}</h2><div class="sub">\${esc(c.phone)}\${c.escalated?' · <b style="color:#f87171">aguardando atendente humano</b>':''}</div>\${msgs}\`;
  el.scrollTop = el.scrollHeight;
}

function select(phone){ selected = phone; renderList(); renderThread(convs.find(c=>c.phone===phone)); }

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;
