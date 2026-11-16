// Teste rápido do parser/template sem precisar de Evolution: npm test
import { parsePromo, renderTemplate } from "../src/lib/parser.ts";
import { extractUrls, isMeliUrl } from "../src/lib/links.ts";
import { DEFAULT_TEMPLATE } from "../src/lib/settings.ts";
import { perfumeInfo, samePerfume } from "../src/lib/perfume.ts";

type Case = { text: string; titulo: string; preco: string; preco_antigo?: string; cupom?: string; pct?: number; cupomOnly?: boolean };

// formatos reais dos grupos de perfume
const cases: Case[] = [
  { text: `*Special Oud Al Wataniah 100ml*\n\nDe ~R$199,00~\nPor *R$104,00* 🤩🔥\n\nLoja Oficial Wathiq Parfums no Mercado Livre\n🔗  https://meli.la/2Zo6UPU`, titulo: "Special Oud Al Wataniah 100ml", preco: "104,00", preco_antigo: "199,00" },
  { text: `*Al Noble Safeer Edp 100ml*\n\nDe ~R$229,00~\nPor *R$135,00* 🤩🔥\n\n🎟 Cupom: *MODA1611*\n\nLoja Oficial Wathiq Parfums no Mercado Livre\n🔗https://meli.la/2zHJtQr`, titulo: "Al Noble Safeer Edp 100ml", preco: "135,00", cupom: "MODA1611" },
  { text: `Armani New Code Giorgio Armani Refillable Eau de Toilette 125ml\n\n❌De 616,15\n✅Por 584,99\n🏷Cupom: RESGATE O CUPOM DE R$ 25 OFF NO CLUBE DA BELEZA\nhttps://s.shopee.com.br/4qEFL9Hmfi`, titulo: "Armani New Code Giorgio Armani Refillable Eau de Toilette 125ml", preco: "584,99", preco_antigo: "616,15", cupom: "" },
  { text: `*OS ÁRABES NÃO SABEM BRINCAR*\n_Loja Oficial *Lipx*_\n\n*Perfume Bareeq Al Dhahab EDP 100ml*\n\nDe R$ 388 por *R$ 119* no Pix 🦸🏻‍♂️\nCupom: *TODOST1411* 🎟️\n\nhttps://meli.la/2mPLM5s`, titulo: "Perfume Bareeq Al Dhahab EDP 100ml", preco: "119,00", preco_antigo: "388,00", cupom: "TODOST1411" },
  { text: `*ORIENTAL DE RESPEITO*\ndocura intensa de mel e baunilha\n\nPerfume Jean Paul Gaultier Le Male Elixir Parfum 75 ml Masculino\n\nDe R$740 por R$371🔥\nCupom: *DEZOFF*🎟️\n\nSelecione a loja *Vanvic*.\nhttps://meli.la/2V2nxHm`, titulo: "Perfume Jean Paul Gaultier Le Male Elixir Parfum 75 ml Masculino", preco: "371,00", preco_antigo: "740,00", cupom: "DEZOFF" },
  { text: `📉 *Baixou 29%*\n\n*Lipx Khamrah Qahwa 100ml*\n\n❌ ~DE: R$253,90~\n✅ POR: R$178,00 (frete full ⚡)\n\n🎟️ CUPOM: *ENTREGASFULL1511* (hoje, 15/11, preço acima já com o cupom)\n\n🛒 LOJA: *Bem Ecom*\n\n📎 LINK DO PRODUTO ➡️ https://meli.la/1kpWKdF`, titulo: "Lipx Khamrah Qahwa 100ml", preco: "178,00", preco_antigo: "253,90", cupom: "ENTREGASFULL1511", pct: 29 },
  { text: `*212 Men Heroes EDT 90ml*\n\nde:R$~750~\n  por:R$*634,23* 👉🛒\n\n🔗https://meli.la/1qnd4N7\n\n🛒Vendido por _Loja Oficial *Carolina Herrera no ML*_☑️`, titulo: "212 Men Heroes EDT 90ml", preco: "634,23", preco_antigo: "750,00" },
  { text: `*Natura Homem Coragio 100ml*\n\nDe: ~R$229,00~\nPor: *R$157,50* 🔥💥\n\n🏷️Cupom: \`VIPNOML\`✅\n\nhttps://meli.la/1NyiRN7`, titulo: "Natura Homem Coragio 100ml", preco: "157,50", cupom: "VIPNOML" },
  { text: `*Invictus Parfum 100 ml*\n\nDe ~R$ 849~\n Por *R$ 467* 🤩💥\n\nLoja Oficial Grifes & Estilo no ML\n🔗https://meli.la/2zcZjep`, titulo: "Invictus Parfum 100 ml", preco: "467,00", preco_antigo: "849,00" },
  { text: `*MENOS DE 80 CONTO NESSE ASAD*‼️\n\n*Perfume Árabe Asad Bourbon 100ml*\n\nDe ~R$187~\nPor *R$78* 🔥\n\n👉 *Pegar promoção:* https://meli.la/2SMh7QB\n\nLoja oficial no MELI!`, titulo: "Perfume Árabe Asad Bourbon 100ml", preco: "78,00", preco_antigo: "187,00" },
  { text: `🚨 CUPOM NOVO NO MELI 🚨\n\nAtive o cupom e pesquise o produto:\nhttps://www.mercadolivre.com/sec/1abc`, titulo: "", preco: "", cupomOnly: true },
];

let fail = 0;
for (const c of cases) {
  const p = parsePromo(c.text);
  const errs: string[] = [];
  if (p.titulo !== c.titulo) errs.push(`titulo "${p.titulo}" ≠ "${c.titulo}"`);
  if (p.preco !== c.preco) errs.push(`preco ${p.preco} ≠ ${c.preco}`);
  if (c.preco_antigo !== undefined && p.preco_antigo !== c.preco_antigo) errs.push(`antigo ${p.preco_antigo} ≠ ${c.preco_antigo}`);
  if (c.cupom !== undefined && p.cupom !== c.cupom) errs.push(`cupom ${p.cupom} ≠ ${c.cupom}`);
  if (c.pct !== undefined && p.descontoPct !== c.pct) errs.push(`pct ${p.descontoPct} ≠ ${c.pct}`);
  if (Boolean(c.cupomOnly) !== p.cupomOnly) errs.push(`cupomOnly ${p.cupomOnly}`);
  if (errs.length) { fail++; console.log("✗", c.titulo || "(cupom)", "\n   ", errs.join("\n    ")); }
  else console.log("✓", c.titulo || "(post de cupom)");
}

// mesmo perfume escrito de jeitos diferentes
const pairs: [string, string, boolean][] = [
  ["Perfume Jean Paul Gaultier Le Male Elixir Parfum 75 ml Masculino", "JPG Le Male Elixir Parfum 75ml", true],
  ["Hugo Boss Bottled Night EDT 100ml", "Perfume Boss Bottled Night Eau de Toilette 100 ml Masculino", true],
  ["Lattafa Asad Bourbon 100ml", "Perfume Árabe Asad Bourbon 100ml", true],
  ["Lattafa Asad 100ml", "Lattafa Asad Bourbon 100ml", false],
  ["Lattafa Asad Elixir 100ml", "Asad 100ml Lattafa", false],
  ["Rasasi Hawas Kobra EDP 100ml", "Hawas Kobra Rasasi Eau de Parfum 100ml", true],
  ["Boticário Clash Extreme 100ml", "O Boticário Clash Desodorante Colônia 100ml", false],
  ["Invictus Parfum 100 ml", "Paco Rabanne Invictus EDT 100ml", false],
  ["Bottled Night 100ml", "Bottled Night 200ml", false],
];
for (const [a, b, want] of pairs) {
  const got = samePerfume(perfumeInfo(a)!, perfumeInfo(b)!);
  if (got !== want) { fail++; console.log("✗ match", a, "|", b, "→", got, perfumeInfo(a), perfumeInfo(b)); }
  else console.log("✓ match", a, "|", b, "→", got);
}

const sample = cases[5].text;
console.log("\n" + renderTemplate(DEFAULT_TEMPLATE, { ...parsePromo(sample), link: "https://meli.la/SEULINK" }));
console.log(extractUrls(sample).map((u) => `${u} ${isMeliUrl(u) ? "[ML]" : ""}`));
if (fail) { console.log(`\n${fail} falha(s)`); process.exit(1); }
console.log("\nTudo certo");
