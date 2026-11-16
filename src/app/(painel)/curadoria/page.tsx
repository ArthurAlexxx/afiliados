"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Sparkles, History, Send, ImageOff, Image as ImageIcon, Flame, Users, Tag, Save, AtSign, ChevronDown, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { api, useApi, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";

type Img = { id: number; score: number; width: number; height: number; disabled: number };
type Row = {
  productId: number;
  name: string;
  ml: number;
  posts: number;
  groups: number;
  recentGroups: number;
  medianPrice: number | null;
  minPrice: number | null;
  bestPrice: number | null;
  pctVsMedian: number | null;
  declaredPct: number | null;
  images: number;
  image: { id: number } | null;
  eligible: boolean;
  why: string;
  score: number;
  lastPostedAt: string | null;
  best: { group: string; price: number; old: number | null; coupon: string | null; at: string; title: string } | null;
  gallery: Img[];
};
type Data = {
  mode: string;
  interval: number;
  brand: { name: string; instagram: string; enabled: boolean };
  lastPickAt: number | null;
  historyImported: string | null;
  totals: { offers: number; offers24h: number; products: number; images: number; curatedSent: number };
  rows: Row[];
};

const brl = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: n % 1 ? 2 : 0 }));

function Kpi({ title, value, hint, icon: Icon }: { title: string; value: React.ReactNode; hint: string; icon: React.ElementType }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted-foreground">{title}</span>
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-2 text-[26px] font-semibold tracking-tight tabular-nums">{value}</div>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>
    </Card>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <div className="relative size-10 shrink-0">
      <svg viewBox="0 0 36 36" className="size-10 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" className="stroke-muted" strokeWidth="3" />
        <circle cx="18" cy="18" r={r} fill="none" className="stroke-foreground" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(Math.min(100, score) / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">{score}</span>
    </div>
  );
}

function RankRow({ r, i, onPost, posting, onToggleImg }: { r: Row; i: number; onPost: () => void; posting: boolean; onToggleImg: (img: Img) => void }) {
  const [open, setOpen] = React.useState(false);
  const cheaper = r.pctVsMedian != null && r.pctVsMedian > 0.02;
  return (
    <li className={cn("px-5 py-3", !r.eligible && "opacity-60")}>
      <div className="flex items-center gap-3">
        <span className="w-5 text-right text-[12px] font-medium text-muted-foreground tabular-nums">{i + 1}</span>
        <button onClick={() => setOpen((o) => !o)} className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
          {r.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/curadoria/foto?id=${r.image.id}&w=160`} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <span className="flex size-full items-center justify-center"><ImageOff className="size-4 text-muted-foreground" /></span>
          )}
          {r.images > 1 && <span className="absolute right-1 bottom-1 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white">{r.images}</span>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">{r.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral"><Users className="size-3" />{r.groups} grupos · {r.posts} posts</Badge>
            {r.bestPrice != null && (
              <Badge tone={cheaper ? "success" : "neutral"}>
                {brl(r.bestPrice)}
                {r.medianPrice ? <span className="opacity-70">· média {brl(r.medianPrice)}</span> : null}
              </Badge>
            )}
            {r.declaredPct ? <Badge tone="accent">-{r.declaredPct}%</Badge> : null}
            {r.recentGroups >= 2 && <Badge tone="warning"><Flame className="size-3" />{r.recentGroups} grupos agora</Badge>}
            {!r.eligible && <span className="text-[11.5px] text-muted-foreground">{r.why}</span>}
          </div>
        </div>
        <ScoreRing score={r.score} />
        <Button size="sm" variant={i === 0 && r.eligible ? "default" : "outline"} onClick={onPost} loading={posting} disabled={!r.best} className="hidden sm:inline-flex">
          {!posting && <Send className="size-3.5" />} Postar
        </Button>
        <button onClick={() => setOpen((o) => !o)} className="text-muted-foreground" aria-label="Detalhes">
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 ml-8 flex flex-col gap-3 rounded-xl bg-muted/50 p-3">
              {r.best && (
                <div className="text-[12.5px] text-muted-foreground">
                  Melhor oferta: <b className="text-foreground">{brl(r.best.price)}</b>
                  {r.best.old ? <> (de {brl(r.best.old)})</> : null} no <b className="text-foreground">{r.best.group}</b>, {timeAgo(r.best.at)}
                  {r.best.coupon ? <> · cupom <code>{r.best.coupon}</code></> : null}
                  {r.lastPostedAt ? <> · postado por nós {timeAgo(r.lastPostedAt)}</> : null}
                </div>
              )}
              {r.gallery.length ? (
                <div className="flex flex-wrap gap-2">
                  {r.gallery.map((g, gi) => (
                    <button key={g.id} onClick={() => onToggleImg(g)} title={g.disabled ? "Foto desativada (clique para usar)" : "Clique para não usar essa foto"} className={cn("relative size-20 overflow-hidden rounded-lg ring-2", gi === 0 && !g.disabled ? "ring-foreground" : "ring-transparent", g.disabled && "opacity-35 grayscale")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/curadoria/foto?id=${g.id}&w=200`} alt="" className="size-full object-cover" loading="lazy" />
                      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9.5px] font-medium text-white">{g.width}px · {g.score}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-[12.5px] text-muted-foreground">Sem foto sem marca d&apos;água ainda. Se for postado agora, usa a foto do anúncio.</div>
              )}
              <div className="flex gap-2">
                {r.image && (
                  <a href={`/api/curadoria/foto?product=${r.productId}&brand=1`} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline"><Wand2 className="size-3.5" /> Ver foto com etiquetas</Button>
                  </a>
                )}
                <Button size="sm" variant="outline" onClick={onPost} loading={posting} disabled={!r.best} className="sm:hidden"><Send className="size-3.5" /> Postar</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export default function CuradoriaPage() {
  const { data, reload } = useApi<Data>("/api/curadoria", 30000);
  const { data: s, setData: setS } = useApi<Record<string, string | number | boolean>>("/api/settings");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [previewKey, setPreviewKey] = React.useState(0);
  const [onlyEligible, setOnlyEligible] = React.useState(false);

  const set = (k: string) => (v: string | number | boolean) => {
    setS((d) => (d ? { ...d, [k]: v } : d));
    setDirty(true);
  };

  const act = async (key: string, json: unknown, ok: (r: { result?: string }) => string) => {
    setBusy(key);
    try {
      const r = await api<{ result?: string }>("/api/curadoria", { method: "POST", json });
      toast.success(ok(r));
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!s) return;
    setBusy("save");
    try {
      await api("/api/settings", {
        method: "PUT",
        json: {
          mode: s.mode,
          brandEnabled: Boolean(s.brandEnabled),
          brandName: String(s.brandName || ""),
          brandInstagram: String(s.brandInstagram || "").trim(),
          curationIntervalMinutes: Number(s.curationIntervalMinutes),
          curationInstantScore: Number(s.curationInstantScore),
          curationPerHour: Number(s.curationPerHour),
          curationCooldownHours: Number(s.curationCooldownHours),
          curationLookbackMinutes: Number(s.curationLookbackMinutes),
          curationRequireImage: Boolean(s.curationRequireImage),
        },
      });
      toast.success("Salvo");
      setDirty(false);
      setPreviewKey((k) => k + 1);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggleImg = async (img: Img) => {
    await api("/api/curadoria", { method: "POST", json: { action: "image", imageId: img.id, disabled: !img.disabled } }).catch((e) => toast.error(e.message));
    reload();
  };

  const rows = (data?.rows || []).filter((r) => !onlyEligible || r.eligible);
  const t = data?.totals;

  return (
    <>
      <PageHeader
        title="Curadoria"
        description="Cada promoção que chega dos grupos é avaliada na hora. Se for boa, sai no seu grupo em segundos, com a melhor foto e o seu link."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => act("import", { action: "import" }, (r) => r.result || "Importado")} loading={busy === "import"}>
              {busy !== "import" && <History className="size-3.5" />} Importar histórico
            </Button>
            <Button size="sm" onClick={() => act("pick", { action: "pick" }, (r) => r.result || "Na fila")} loading={busy === "pick"}>
              {busy !== "pick" && <Sparkles className="size-3.5" />} Postar o melhor agora
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi title="Ofertas lidas (24h)" value={t?.offers24h ?? "—"} hint={`${t?.offers ?? 0} no total`} icon={Tag} />
        <Kpi title="Perfumes identificados" value={t?.products ?? "—"} hint="mesmo perfume entre grupos vira um só" icon={Sparkles} />
        <Kpi title="Fotos no banco" value={t?.images ?? "—"} hint="só de grupos sem marca d'água" icon={ImageIcon} />
        <Kpi
          title="Postados pela curadoria"
          value={t?.curatedSent ?? "—"}
          hint={data?.lastPickAt ? `última escolha ${timeAgo(new Date(data.lastPickAt).toISOString().slice(0, 19).replace("T", " "))}` : data?.mode === "curated" ? "posta assim que chega promoção boa" : "curadoria desligada"}
          icon={Send}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title="Ranking agora"
            description="Nota = quantos grupos postam + preço contra a média do próprio perfume + se está bombando agora. O 1º elegível é o próximo post."
            action={<Switch checked={onlyEligible} onChange={setOnlyEligible} label="Só elegíveis" />}
          />
          <CardContent className="px-0 pb-0">
            {!data ? (
              <div className="mx-5 mb-5 h-80 animate-pulse rounded-xl bg-muted" />
            ) : rows.length ? (
              <ul className="divide-y border-t">
                {rows.map((r, i) => (
                  <RankRow
                    key={r.productId}
                    r={r}
                    i={i}
                    posting={busy === `p${r.productId}`}
                    onPost={() => act(`p${r.productId}`, { action: "pick", productId: r.productId }, (x) => x.result || "Na fila")}
                    onToggleImg={toggleImg}
                  />
                ))}
              </ul>
            ) : (
              <div className="border-t px-5 py-12 text-center">
                <div className="text-[14px] font-medium">Nenhuma oferta ainda</div>
                <p className="mt-1 text-[13px] text-muted-foreground">Marque os grupos de origem em Grupos e clique em <b>Importar histórico</b>.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Identidade visual" description="Etiquetas de vidro na foto: desconto embaixo à esquerda, seu grupo em cima à direita." />
            <CardContent className="flex flex-col gap-4">
              <div className="overflow-hidden rounded-xl border bg-muted">
                {t?.images ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={previewKey} src={`/api/curadoria/foto?sample=1&w=760&k=${previewKey}`} alt="Prévia das etiquetas" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-[12.5px] text-muted-foreground">A prévia aparece quando houver fotos no banco</div>
                )}
              </div>
              {s && (
                <>
                  <Switch checked={Boolean(s.brandEnabled)} onChange={set("brandEnabled")} label="Aplicar etiquetas nas fotos" />
                  <Field label="Nome na etiqueta" hint={`Vazio = nome do grupo de destino (${data?.brand.name || "—"})`}>
                    <Input value={String(s.brandName || "")} onChange={(e) => set("brandName")(e.target.value)} placeholder={data?.brand.name} />
                  </Field>
                  <Field label="Instagram">
                    <div className="relative">
                      <AtSign className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input value={String(s.brandInstagram || "")} onChange={(e) => set("brandInstagram")(e.target.value)} placeholder="@seuperfil" className="pl-9" />
                    </div>
                  </Field>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Como escolher" />
            {s && (
              <CardContent className="flex flex-col gap-4">
                <Field label="Modo">
                  <Select
                    value={String(s.mode)}
                    onChange={set("mode")}
                    options={[
                      { value: "curated", label: "Curadoria: posta só o melhor de cada rodada" },
                      { value: "repost", label: "Repostar tudo que chega dos grupos" },
                    ]}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nota para postar na hora" hint="Promoção que chega com essa nota ou mais sai na mesma hora.">
                    <Input type="number" min={1} max={100} value={String(s.curationInstantScore)} onChange={(e) => set("curationInstantScore")(e.target.value)} />
                  </Field>
                  <Field label="Não repetir por (h)">
                    <Input type="number" min={1} value={String(s.curationCooldownHours)} onChange={(e) => set("curationCooldownHours")(e.target.value)} />
                  </Field>
                </div>
                <Field label="Posts por hora (ritmo médio)" hint="A média dos grupos é ~5 por hora. Promoção boa que chega antes da vaga espera alguns minutos; sai a melhor.">
                  <Input type="number" min={0} value={String(s.curationPerHour)} onChange={(e) => set("curationPerHour")(e.target.value)} />
                </Field>
                <Field label="Postar o melhor a cada (min)" hint="Opcional. 0 = sem rodada fixa, só posta quando chega promoção boa.">
                  <Input type="number" min={0} value={String(s.curationIntervalMinutes)} onChange={(e) => set("curationIntervalMinutes")(e.target.value)} />
                </Field>
                <Field label="Oferta vale por (min)" hint="Só posta promoções que os grupos publicaram nesse intervalo, para o preço ainda estar valendo.">
                  <Input type="number" min={5} value={String(s.curationLookbackMinutes)} onChange={(e) => set("curationLookbackMinutes")(e.target.value)} />
                </Field>
                <Switch checked={Boolean(s.curationRequireImage)} onChange={set("curationRequireImage")} label="Só postar com foto do banco" description="Sem isso, usa a foto do anúncio quando o perfume não tem foto boa." />
                <Button onClick={save} loading={busy === "save"} disabled={!dirty}>
                  {busy !== "save" && <Save className="size-4" />} Salvar
                </Button>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
