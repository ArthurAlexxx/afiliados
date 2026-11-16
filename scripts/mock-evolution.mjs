// Servidor falso da Evolution API para testes locais: node scripts/mock-evolution.mjs
import http from "node:http";
import sharp from "sharp";
const sent = [];

// grupos e mensagens de exemplo (formatos reais dos grupos de perfume)
const GROUPS = [
  { id: "g1@g.us", subject: "#81 MAENO PROMOS | PERFUMES", size: 900 },
  { id: "g8@g.us", subject: "Herói do Perfume #306", size: 1000 },
  { id: "g11@g.us", subject: "RP PROMOS - Perfumes Masculinos Originais", size: 800 },
  { id: "g12@g.us", subject: "MD Links #94", size: 700 },
  { id: "dest@g.us", subject: "Radar Ofertas · Perfumes (teste)", size: 3 },
  { id: "x@g.us", subject: "Família", size: 12 },
];
const now = Math.floor(Date.now() / 1000);
const MSGS = {
  "g1@g.us": [
    ["*Lattafa Khamrah Qahwa 100ml*\n\nDe ~R$289,00~\nPor *R$169,00* 🤩🔥\n\nLoja Oficial Lipx no Mercado Livre\n🔗 https://meli.la/AAA1", 1],
    ["*Hugo Boss Bottled Night EDT 100ml*\n\nDe ~R$600,00~\nPor *R$289,00* 🤩🔥\n\n🔗 https://meli.la/AAA2", 2],
    ["*Special Oud Al Wataniah 100ml*\n\nDe ~R$199,00~\nPor *R$104,00* 🤩🔥\n\n🔗 https://meli.la/AAA3", 3],
  ],
  "g8@g.us": [
    ["*OS ÁRABES NÃO SABEM BRINCAR*\n_Loja Oficial *Lipx*_\n\n*Perfume Khamrah Qahwa Lattafa EDP 100ml*\n\nDe R$ 388 por *R$ 159* no Pix 🦸🏻‍♂️\nCupom: *TODOST1411* 🎟️\n\nhttps://meli.la/BBB1", 4],
    ["*BOSS DA NOITE*\n\n*Perfume Boss Bottled Night Eau de Toilette 100 ml Masculino*\n\nDe R$ 600 por *R$ 299* no Pix\n\nhttps://meli.la/BBB2", 5],
  ],
  "g11@g.us": [
    ["📉 *Baixou 41%*\n\n*Lipx Khamrah Qahwa 100ml*\n\n❌ ~DE: R$253,90~\n✅ POR: R$149,90 (frete full ⚡)\n\n🎟️ CUPOM: *ENTREGASFULL1511*\n\n📎 LINK DO PRODUTO ➡️ https://meli.la/CCC1", 6],
  ],
  "g12@g.us": [
    ["*Bottled Night Hugo Boss 100ml EDT*\n\nde:R$~600~\n  por:R$*279,90* 👉🛒\n\n🔗https://meli.la/DDD1", 7],
    ["🚨 CUPOM NOVO 🚨\nAtive e pesquise: https://www.mercadolivre.com/sec/1abc", 0],
  ],
};
async function photo(seed) {
  const hue = (seed * 67) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1400"><defs><radialGradient id="g" cx="0.3" cy="0.3" r="1"><stop offset="0" stop-color="hsl(${hue},70%,75%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},50%,20%)"/></radialGradient></defs><rect width="1400" height="1400" fill="url(#g)"/><circle cx="${300 + seed * 90}" cy="1050" r="230" fill="hsl(${(hue + 120) % 360},45%,35%)"/><rect x="560" y="420" width="300" height="680" rx="40" fill="hsl(${(hue + 200) % 360},40%,30%)"/><rect x="640" y="290" width="140" height="140" rx="14" fill="#111"/></svg>`;
  return (await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer()).toString("base64");
}
let state = process.env.MOCK_OPEN ? "open" : "close";
let connectAt = 0;
http
  .createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const json = (o, s = 200) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.headers.apikey !== "teste") return json({ error: "unauthorized" }, 401);
    const u = req.url || "";
    if (u.startsWith("/instance/connectionState")) {
      if (state === "connecting" && Date.now() - connectAt > 8000) state = "open"; // simula a leitura do QR
      return json({ instance: { state } });
    }
    if (u.startsWith("/instance/connect")) {
      state = "connecting"; connectAt = Date.now();
      return json({ pairingCode: "WZYEH1YY", code: "2@mock", base64: "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path d="M2 2h7v7H2zM20 2h7v7h-7zM2 20h7v7H2z" fill="none" stroke="#000" stroke-width="2"/><path d="M12 3h2v2h-2zM15 6h2v3h-2zM11 11h3v2h-3zM17 12h2v2h-2zM12 16h2v4h-2zM16 17h5v2h-5zM22 14h3v2h-3zM21 21h4v4h-4z"/></svg>').toString("base64") });
    }
    if (u.startsWith("/instance/logout")) { state = "close"; return json({ ok: true }); }
    if (u.startsWith("/group/fetchAllGroups")) return json(GROUPS);
    if (u.startsWith("/chat/findMessages")) {
      const jid = JSON.parse(body).where.key.remoteJid;
      const list = (MSGS[jid] || []).map(([text, img], i) => ({
        key: { id: `${jid.split("@")[0]}-${i}`, remoteJid: jid },
        messageTimestamp: now - (i + 1) * 1800,
        message: img ? { imageMessage: { caption: text, mimetype: "image/jpeg" } } : { conversation: text },
      }));
      return json({ messages: { total: list.length, pages: 1, currentPage: 1, records: list } });
    }
    if (u.startsWith("/chat/fetchProfilePictureUrl")) return json({ profilePictureUrl: null });
    if (u.startsWith("/message/send")) { sent.push({ path: u, ...JSON.parse(body) }); console.log("ENVIADO", u, JSON.stringify(JSON.parse(body)).slice(0, 400)); return json({ key: { id: "x" } }); }
    if (u.startsWith("/chat/getBase64FromMediaMessage")) {
      const id = JSON.parse(body).message.key.id;
      return json({ base64: await photo(id.length + Number(id.split("-").pop() || 0) * 3 + id.charCodeAt(1)), mimetype: "image/jpeg" });
    }
    if (u.startsWith("/webhook/set")) { console.log("WEBHOOK SET", body); return json({ ok: true }); }
    if (u.startsWith("/webhook/find")) return json({ url: "", enabled: false });
    if (u === "/__sent") return json(sent);
    json({ error: "not found " + u }, 404);
  })
  .listen(8081, () => console.log("mock evolution on :8081"));
