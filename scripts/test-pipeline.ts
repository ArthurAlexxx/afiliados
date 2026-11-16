// Teste rápido do parser/template sem precisar de Evolution: npm test
import { parsePromo, renderTemplate } from "../src/lib/parser.ts";
import { extractUrls, isMeliUrl } from "../src/lib/links.ts";
import { DEFAULT_TEMPLATE } from "../src/lib/settings.ts";

const samples = [
  `🔥 *Fone de Ouvido Bluetooth JBL Tune 520BT* 🔥

~De R$ 349,90~
✅ Por R$ 199,90
💳 10x de R$ 19,99 sem juros
🎟️ Use o cupom: JBL20
🚚 Frete grátis

🛒 https://meli.la/2xYzAbC`,
  `ACHADINHO 😱
Air Fryer Mondial 4L Preta
R$ 279,00 → R$ 189,90
https://www.mercadolivre.com.br/air-fryer-mondial/p/MLB19500111?matt_word=outro
Entre no nosso grupo: https://chat.whatsapp.com/abc`,
  `Smartwatch Xiaomi Redmi Watch 5 Active
Por apenas R$ 149
https://produto.mercadolivre.com.br/MLB-3456789012-smartwatch-_JM`,
];

for (const t of samples) {
  const urls = extractUrls(t);
  const p = parsePromo(t);
  console.log("URLS:", urls.map((u) => `${u} ${isMeliUrl(u) ? "[ML]" : ""}`));
  console.log("DADOS:", p);
  console.log("----\n" + renderTemplate(DEFAULT_TEMPLATE, { ...p, link: "https://meli.la/SEULINK" }) + "\n====\n");
}
