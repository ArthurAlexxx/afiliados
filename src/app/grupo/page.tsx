import type { Metadata, Viewport } from "next";
import { dadosLanding, type Oferta } from "@/lib/landing";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { GrupoPixel } from "./grupo-pixel";
import { GrupoFixo } from "./grupo-fixo";
import { GrupoCarrossel } from "./grupo-carrossel";
import "./grupo.css";

/* LANDING PAGE DO ANÚNCIO — /grupo
   =====================================================================
   Para onde os anúncios do Meta mandam as pessoas. Pública (ver proxy.ts).

   O DESENHO é o da Supercopa dos Streamers (repo supercopa): fundo --ink,
   títulos em Epic Pro, todo rótulo em Roboto Mono maiúsculo e espaçado,
   cabeçalho de seção eyebrow (nome ··· linha pontilhada ··· qualificador)
   + sec-head, cards --ink-2 com hover que sobe 2px, botão pílula lima com
   texto escuro. O lima aqui é o #b6ff1a dos anúncios, não o #D4EA4A de lá.

   A ORDEM DAS SEÇÕES vem das landing pages dos grupos de oferta que estão
   rodando há mais tempo na Biblioteca de Anúncios (Tá Baratasso, Garimpeiros,
   OQ Comprei, Pincei Ofertas, Rocha Promos, Promos Perfume das Divas):
     1. promessa + UM botão + "grátis · sem spam · sai quando quiser"
     2. "você vai receber assim": print/post real do grupo
     3. como funciona em 3 passos
     4. por que entrar (benefícios)
     5. números / prova social
     6. dúvidas (originalidade, spam, se a compra é no grupo)
     7. o mesmo botão de novo, e fixo no rodapé do celular
   O que nenhum deles tem, e aqui tem: as ofertas da vitrine são os posts que
   o sistema mandou de verdade, com o preço daquele momento. */

export const dynamic = "force-dynamic";

const TITULO = "2R PROMOS · Grupo de promoções de perfume";
const DESCRICAO =
  "Nosso robô vigia mais de 200 grupos de promoção e manda pro nosso grupo só o menor preço de todos. Perfume original, link do Mercado Livre, grátis e sem spam.";

export const metadata: Metadata = {
  title: TITULO,
  description: DESCRICAO,
  openGraph: { title: TITULO, description: DESCRICAO, images: ["/brand/2r-promos-640.jpg"], locale: "pt_BR", type: "website" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0d0f12" };

const ENTRAR = "/grupo/entrar";
const brl = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

function haQuanto(iso: string) {
  const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

function membrosDoGrupo(): number | null {
  try {
    const r = db().prepare("SELECT MAX(size) n FROM groups WHERE role = 'destination'").get() as { n: number | null } | undefined;
    return r?.n ?? null;
  } catch {
    return null;
  }
}

/** Botão principal. `data-lead` é o que o pixel escuta para marcar o Lead. */
function BotaoEntrar({ children = "Entrar no grupo grátis", grande = false }: { children?: React.ReactNode; grande?: boolean }) {
  return (
    <a className={`lp-btn${grande ? " lp-btn--grande" : ""}`} href={ENTRAR} data-lead="">
      <IconeWhats />
      {children}
      <span className="lp-btn__seta" aria-hidden="true" />
    </a>
  );
}

function IconeWhats() {
  return (
    <svg className="lp-btn__ico" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.3Z"
      />
    </svg>
  );
}

function Marca() {
  return (
    <span className="lp-marca" aria-label="2R PROMOS">
      <span className="lp-marca__2r" aria-hidden="true">
        2R
        <svg className="lp-marca__sinal" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 9a9 9 0 0 1 9 9" />
          <path d="M4 3a15 15 0 0 1 15 15" />
        </svg>
      </span>
      <span className="lp-marca__promos" aria-hidden="true">PROMOS</span>
    </span>
  );
}

function Eyebrow({ nome, label }: { nome: string; label: string }) {
  return (
    <div className="lp-eyebrow">
      <span className="lp-eyebrow__nome">{nome}</span>
      <span className="lp-eyebrow__linha" aria-hidden="true" />
      <span className="lp-eyebrow__label">{label}</span>
    </div>
  );
}

/** Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, `mono`) em HTML. Escapa antes. */
function waHtml(texto: string) {
  const esc = texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return esc
    .replace(/https?:\/\/\S+/g, (u) => `<span class="lp-wa__link">${u.length > 38 ? u.slice(0, 36) + "…" : u}</span>`)
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:]|$)/gm, "$1<b>$2</b>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:]|$)/gm, "$1<i>$2</i>")
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:]|$)/gm, "$1<s>$2</s>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Um post do grupo exatamente como saiu: foto inteira (sem corte) + o texto do WhatsApp. */
function Balao({ o, eager = false }: { o: Oferta; eager?: boolean }) {
  return (
    <div className="lp-wa">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="lp-wa__foto"
        src={`/grupo/foto/${o.id}`}
        alt={o.nome}
        width={o.largura ?? undefined}
        height={o.altura ?? undefined}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
      />
      <p className="lp-wa__texto" dangerouslySetInnerHTML={{ __html: waHtml(o.texto) }} />
      <span className="lp-wa__hora">{hora(o.quando)}</span>
    </div>
  );
}

/** Foto real de um perfume que saiu no grupo, ao lado do título do card. */
function Miniatura({ o }: { o?: Oferta }) {
  if (!o) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="lp-card__foto" src={`/grupo/foto/${o.id}`} alt="" aria-hidden="true" loading="lazy" decoding="async" />;
}

/** O post como ele chega no WhatsApp: é a peça do hero (o "você vai receber assim"). */
function Celular({ o }: { o: Oferta }) {
  return (
    <figure className="lp-celular">
      <div className="lp-celular__topo">
        <span className="lp-celular__avatar" aria-hidden="true">2R</span>
        <span>
          <b>2R PROMOS</b>
          <small>grupo de ofertas · só admins postam</small>
        </span>
      </div>
      <div className="lp-celular__chat">
        <Balao o={o} eager />
      </div>
      <figcaption className="sr-only">Post real do grupo: {o.nome} por R$ {brl(o.por)}</figcaption>
    </figure>
  );
}

export default async function GrupoPage() {
  const { grupos, ofertas24h, postsHoje, ofertas, destaque } = await dadosLanding();
  const { metaPixelId } = getSettings();
  const membros = membrosDoGrupo();

  // O anúncio promete "mais de 200 grupos". O número real só aparece quando confirma isso.
  const gruposTxt = grupos && grupos >= 200 ? `${grupos}` : "200+";
  const maiorPct = Math.max(0, ...ofertas.map((o) => o.pct || 0));
  // Foto real de perfume ao lado do título de cada benefício (no lugar dos ícones).
  const fotos = ofertas.filter((o) => o.id !== destaque?.id);

  return (
    <div className="lp">
      <a className="lp-skip" href="#topo">Pular para o conteúdo</a>
      <GrupoPixel pixelId={metaPixelId} />

      <header className="lp-topo">
        <div className="lp-wrap lp-topo__in">
          <Marca />
          <a className="lp-topo__btn" href={ENTRAR} data-lead="">
            Entrar grátis
          </a>
        </div>
      </header>

      <main id="topo">
        {/* ---------- HERO ---------- */}
        <section className={`lp-hero${destaque ? "" : " lp-hero--so-texto"}`}>
          <div className="lp-wrap lp-hero__in">
            <div className="lp-hero__txt">
              <p className="lp-hero__status">
                <span className="lp-hero__status-dot" aria-hidden="true" />
                Robô ligado · vigiando {gruposTxt} grupos
              </p>
              <h1 className="lp-hero__titulo">
                Pagou mais de <em>R$&nbsp;200</em> num perfume?
              </h1>
              <p className="lp-hero__frase">
                Nosso robô vigia mais de 200 grupos de promoção o dia inteiro e manda pro nosso grupo só o{" "}
                <b>menor preço de todos</b>. Perfume original, link do Mercado Livre, compra garantida.
              </p>
              <div className="lp-hero__acoes" data-hero-cta="">
                <BotaoEntrar grande />
              </div>
              <ul className="lp-selos" aria-label="Condições">
                <li>Grátis</li>
                <li>Sem spam</li>
                <li>Sai quando quiser</li>
              </ul>
            </div>
            {destaque ? (
              <div className="lp-hero__vitrine">
                <Celular o={destaque} />
                <p className="lp-hero__legenda" aria-hidden="true">
                  ↑ post real do grupo{/club\s*de\s*nuit/i.test(destaque.nome) ? ", o mesmo perfume do anúncio" : ", do jeito que chega"}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        {ofertas.length ? (
          <>
            {/* ---------- FAIXA ---------- */}
            <div className="lp-faixa" aria-hidden="true">
              <div className="lp-faixa__trilho">
                {[0, 1].map((k) => (
                  <span className="lp-faixa__grupo" key={k}>
                    {ofertas.map((o, i) => (
                      <span className="lp-faixa__item" key={i}>
                        {o.nome.split(" ").slice(0, 4).join(" ")}
                        {o.pct ? <b>−{o.pct}%</b> : null}
                        <i>R$ {brl(o.por)}</i>
                      </span>
                    ))}
                  </span>
                ))}
              </div>
            </div>

            {/* ---------- VITRINE ----------
                Os posts como saíram no grupo (foto inteira + texto do WhatsApp),
                os que mais vendem no ML primeiro (RadarHub). */}
            <section className="lp-sec" id="conteudo">
              <div className="lp-wrap">
                <Eyebrow nome="Vitrine" label="Melhores do dia" />
                <div className="lp-head">
                  <h2>Olha o que saiu no grupo</h2>
                  <p>
                    As melhores promoções do dia, do jeito que chegaram no WhatsApp. Primeiro as que mais vendem no Mercado
                    Livre. Promoção acaba rápido: quem está no grupo vê primeiro.
                  </p>
                </div>
                <GrupoCarrossel>
                  {ofertas.map((o) => (
                    <li className="lp-chat__item" key={o.id}>
                      <p className="lp-chat__meta">
                        {o.vendas ? <span className="lp-chat__selo">🔥 {o.vendas}</span> : null}
                        <span>{haQuanto(o.quando)}</span>
                      </p>
                      <Balao o={o} />
                    </li>
                  ))}
                </GrupoCarrossel>
                <div className="lp-centro">
                  <BotaoEntrar>Quero receber as próximas</BotaoEntrar>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {/* ---------- COMO FUNCIONA ---------- */}
        <section className="lp-sec">
          <div className="lp-wrap">
            <Eyebrow nome="Como funciona" label="3 passos" />
            <div className="lp-head">
              <h2>A gente garimpa. Você só compra.</h2>
              <p>Ninguém tem tempo de ficar em 200 grupos. O robô fica, e te manda só o que vale a pena.</p>
            </div>
            <ol className="lp-passos">
              <li className="lp-card">
                <div className="lp-card__topo">
                  <span className="lp-card__n">01</span>
                  <h3>Vigia {gruposTxt} grupos</h3>
                </div>
                <p>Lê cada promoção de perfume que cai nos maiores grupos de oferta do Brasil, 24 horas por dia.</p>
              </li>
              <li className="lp-card">
                <div className="lp-card__topo">
                  <span className="lp-card__n">02</span>
                  <h3>Compara e fica com o menor</h3>
                </div>
                <p>
                  O mesmo perfume saiu em 10 grupos? Ele compara e fica só com o <b>menor preço</b>. Desconto de mentira, com o
                  &quot;DE&quot; inflado, fica de fora.
                </p>
              </li>
              <li className="lp-card">
                <div className="lp-card__topo">
                  <span className="lp-card__n">03</span>
                  <h3>Chega no seu WhatsApp</h3>
                </div>
                <p>Com foto, o DE e o POR, e o link oficial do Mercado Livre. É tocar e comprar.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* ---------- POR QUE ENTRAR ---------- */}
        <section className="lp-sec">
          <div className="lp-wrap">
            <Eyebrow nome="Por que entrar" label="Grupo gratuito" />
            <div className="lp-head">
              <h2>Feito pra quem odeia pagar caro</h2>
              <p>Quatro regras que o grupo segue em todo post.</p>
            </div>
            <ul className="lp-beneficios">
              <li className="lp-card">
                <div className="lp-card__topo">
                  <Miniatura o={fotos[0]} />
                  <h3>Menor preço de todos os grupos</h3>
                </div>
                <p>Não é a promoção de uma loja: é a melhor entre todas as que apareceram.</p>
              </li>
              <li className="lp-card">
                <div className="lp-card__topo">
                  <Miniatura o={fotos[1]} />
                  <h3>Link do Mercado Livre</h3>
                </div>
                <p>A compra é no Mercado Livre, com Compra Garantida: não chegou ou veio errado, o dinheiro volta.</p>
              </li>
              <li className="lp-card">
                <div className="lp-card__topo">
                  <Miniatura o={fotos[2]} />
                  <h3>Original, vendedor verificado</h3>
                </div>
                <p>Só loja oficial ou vendedor com reputação alta. Contratipo e réplica ficam de fora.</p>
              </li>
              <li className="lp-card">
                <div className="lp-card__topo">
                  <Miniatura o={fotos[3]} />
                  <h3>Sem spam</h3>
                </div>
                <p>Só os admins postam, e só promoção de perfume. Nada de corrente nem conversa.</p>
              </li>
            </ul>
          </div>
        </section>

        {/* ---------- NÚMEROS ---------- */}
        <section className="lp-sec lp-sec--numeros">
          <div className="lp-wrap">
            <Eyebrow nome="Em números" label="Atualizado agora" />
            <dl className="lp-numeros">
              <div className="lp-numero">
                <dt>Grupos vigiados</dt>
                <dd>{gruposTxt}</dd>
              </div>
              <div className="lp-numero">
                <dt>Promoções lidas em 24 h</dt>
                <dd>{ofertas24h && ofertas24h > 0 ? ofertas24h.toLocaleString("pt-BR") : "–"}</dd>
              </div>
              <div className="lp-numero">
                <dt>Maior desconto na vitrine</dt>
                <dd>{maiorPct ? `${maiorPct}%` : "–"}</dd>
              </div>
              <div className="lp-numero">
                <dt>{membros && membros >= 50 ? "Pessoas no grupo" : "Para entrar"}</dt>
                <dd>{membros && membros >= 50 ? membros.toLocaleString("pt-BR") : "R$ 0"}</dd>
              </div>
            </dl>
            {postsHoje ? <p className="lp-nota">{postsHoje} {postsHoje === 1 ? "promoção saiu" : "promoções saíram"} no grupo hoje.</p> : null}
          </div>
        </section>

        {/* ---------- DÚVIDAS ---------- */}
        <section className="lp-sec">
          <div className="lp-wrap lp-wrap--estreito">
            <Eyebrow nome="Dúvidas" label="Perguntas frequentes" />
            <div className="lp-head">
              <h2>Antes de entrar</h2>
            </div>
            <div className="lp-faq">
              {FAQ.map(([p, r], i) => (
                <details className="lp-faq__item" key={i} open={i === 0}>
                  <summary>
                    <h3>{p}</h3>
                    <span className="lp-faq__seta" aria-hidden="true" />
                  </summary>
                  <p>{r}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- CTA FINAL ---------- */}
        <section className="lp-sec lp-final" id="entrar">
          <div className="lp-wrap lp-final__in">
            <h2>A próxima promoção pode sair agora</h2>
            <p>Entra no grupo e deixa o robô procurar por você.</p>
            <BotaoEntrar grande />
            <ul className="lp-selos lp-selos--centro" aria-label="Condições">
              <li>Grátis</li>
              <li>Sem spam</li>
              <li>Sai quando quiser</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="lp-rodape">
        <div className="lp-wrap lp-rodape__in">
          <Marca />
          <p>
            Participamos do Programa de Afiliados do Mercado Livre: quando você compra pelo nosso link, ganhamos uma
            comissão e o preço pra você é o mesmo. Não somos o Mercado Livre. Preços e estoque podem mudar a qualquer
            momento.
          </p>
          <p>© {new Date().getFullYear()} 2R PROMOS</p>
        </div>
      </footer>

      {/* Botão fixo no celular: os anúncios mandam quase só tráfego mobile. */}
      <GrupoFixo>
        <BotaoEntrar />
      </GrupoFixo>
    </div>
  );
}

const FAQ: [string, string][] = [
  [
    "É grátis mesmo?",
    "Sim. Quando você compra pelo link do grupo, o Mercado Livre paga uma comissão pra gente. O preço pra você é exatamente o mesmo.",
  ],
  [
    "Eu compro no grupo?",
    "Não. O grupo só manda a promoção com o link. A compra é no Mercado Livre, com Compra Garantida: se não chegar ou vier diferente do anúncio, o dinheiro volta.",
  ],
  [
    "Os perfumes são originais?",
    "Só entra link de loja oficial ou de vendedor com reputação alta no Mercado Livre. Contratipo, réplica e 'inspirado em' ficam de fora.",
  ],
  [
    "Vou receber spam?",
    "Não. Só os admins postam, e só promoção de perfume. Ninguém manda corrente nem fica conversando. Dá pra silenciar ou sair quando quiser.",
  ],
  [
    "Quantas mensagens chegam por dia?",
    "Algumas. O robô só posta quando acha um preço que vale a pena, então tem dia com mais e dia com menos.",
  ],
  [
    "Por que fica tão barato?",
    "Preço de perfume muda toda hora: cupom, oferta relâmpago, loja baixando pra vender. O robô pega esse momento e avisa na hora.",
  ],
];
