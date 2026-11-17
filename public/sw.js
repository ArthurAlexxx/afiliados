/* Service worker do app no celular: avisos (push) e abrir o painel ao tocar. Sem cache de dados: tudo vem ao vivo do servidor. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  // só a navegação: sem internet, mostra um aviso em vez da tela de erro do navegador
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch(
      () =>
        new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f3f4f6;color:#374151;text-align:center;padding:24px"><div><div style="font-size:40px">📶</div><p style="font-weight:600">Sem internet</p><p style="font-size:14px;color:#6b7280">Assim que voltar, puxe para baixo ou toque para tentar de novo.</p><button onclick="location.reload()" style="margin-top:8px;padding:10px 18px;border-radius:10px;border:0;background:#8470ff;color:#fff;font-weight:600">Tentar de novo</button></div></body>',
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    ),
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: "Afiliados", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "Afiliados", {
      body: d.body || "",
      icon: d.image || "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: d.tag,
      renotify: Boolean(d.tag),
      data: { url: d.url || "/fila" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/fila";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.navigate(url).then((w) => (w || c).focus());
      return self.clients.openWindow(url);
    }),
  );
});
