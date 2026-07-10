// Cliente da Meta WhatsApp Cloud API: envio de mensagens de texto.

const GRAPH_VERSION = "v21.0";

export async function sendText(to, body) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: true, body },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[whatsapp] falha ao enviar:", res.status, err);
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }
  return res.json();
}

// Extrai a(s) mensagem(ns) de texto recebida(s) do payload do webhook.
// Retorna array de { from, text, name }.
export function parseIncoming(body) {
  const out = [];
  const entries = body?.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      const name = contacts[0]?.profile?.name;
      for (const msg of value.messages || []) {
        if (msg.type === "text") {
          out.push({ from: msg.from, text: msg.text?.body || "", name });
        } else {
          // Mídia/áudio/imagem: MVP responde pedindo texto (tratar depois).
          out.push({ from: msg.from, text: "[mensagem não textual]", name, nonText: true });
        }
      }
    }
  }
  return out;
}
