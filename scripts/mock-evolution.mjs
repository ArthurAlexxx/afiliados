// Servidor falso da Evolution API para testes locais: node scripts/mock-evolution.mjs
import http from "node:http";
const sent = [];
let state = "close";
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
    if (u.startsWith("/group/fetchAllGroups"))
      return json([
        { id: "111@g.us", subject: "Promoções Top 🔥", size: 512 },
        { id: "222@g.us", subject: "Achadinhos ML", size: 256 },
        { id: "999@g.us", subject: "Meu Grupo de Ofertas", size: 1024 },
      ]);
    if (u.startsWith("/message/send")) { sent.push({ path: u, ...JSON.parse(body) }); console.log("ENVIADO", u, JSON.stringify(JSON.parse(body)).slice(0, 400)); return json({ key: { id: "x" } }); }
    if (u.startsWith("/chat/getBase64FromMediaMessage")) return json({ base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", mimetype: "image/png" });
    if (u.startsWith("/webhook/set")) { console.log("WEBHOOK SET", body); return json({ ok: true }); }
    if (u.startsWith("/webhook/find")) return json({ url: "", enabled: false });
    if (u === "/__sent") return json(sent);
    json({ error: "not found " + u }, 404);
  })
  .listen(8081, () => console.log("mock evolution on :8081"));
