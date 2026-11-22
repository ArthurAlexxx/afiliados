"use client";

import * as React from "react";
import { toast } from "sonner";
import { TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, timeAgo, useApi } from "@/lib/client";

type Rules = { minPct: number; greatPct: number; nearMin: number; minSamples: number; minGroups: number; repeatHours: number };
type Data = {
  group: { jid: string; name: string } | null;
  rules: Rules;
  posts: { id: number; status: string; reason: string | null; via: string; created_at: string; name: string; price: number | null; ref: number | null }[];
  prices: { n: number; p: number; g: number };
  sim: { checked: number; total: number; deals: { at: string; name: string; group: string; price: number; ref: number; pct: number; label: string }[] };
};

const brl = (n: number | null) => (n == null ? "?" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const STATUS: Record<string, string> = { review: "Esperando aprovação", photo: "Esperando foto", queued: "Na fila", sending: "Enviando", sent: "Enviado", skipped: "Descartado", failed: "Falhou" };

/** Grupo de ofertas boas (teste 2): só publica quando o preço está bem abaixo do normal dos grupos. */
export function DealsCard() {
  const { data, reload } = useApi<Data>("/api/deals", 60000);
  const [minPct, setMinPct] = React.useState("");
  const [greatPct, setGreatPct] = React.useState("");
  React.useEffect(() => {
    if (data) {
      setMinPct(String(Math.round(data.rules.minPct * 100)));
      setGreatPct(String(Math.round(data.rules.greatPct * 100)));
    }
  }, [data?.rules.minPct, data?.rules.greatPct]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;

  const save = async () => {
    try {
      await api("/api/deals", { method: "PATCH", json: { minPct: Number(minPct) / 100, greatPct: Number(greatPct) / 100 } });
      toast.success("Regras salvas");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader
        title="Ofertas boas (grupo teste 2)"
        description={
          data.group
            ? `Publica em "${data.group.name}" só quando uma promoção de qualquer grupo sai bem abaixo do preço normal.`
            : 'Marque um grupo como "Ofertas boas" na lista abaixo para começar.'
        }
      />
      <CardContent className="space-y-4">
        <div className="text-[12.5px] text-muted-foreground">
          Banco de preços: {data.prices.n.toLocaleString("pt-BR")} preços de {data.prices.p.toLocaleString("pt-BR")} perfumes em {data.prices.g} grupos (30 dias).
        </div>
        <div className="flex flex-wrap items-end gap-3 text-[12.5px]">
          <label className="space-y-1">
            <div className="text-muted-foreground">Boa: % abaixo do normal</div>
            <Input className="w-24" inputMode="numeric" value={minPct} onChange={(e) => setMinPct(e.target.value)} />
          </label>
          <label className="space-y-1">
            <div className="text-muted-foreground">Ótima: % abaixo do normal</div>
            <Input className="w-24" inputMode="numeric" value={greatPct} onChange={(e) => setGreatPct(e.target.value)} />
          </label>
          <Button size="sm" onClick={save}>Salvar</Button>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Preço normal = mediana do que os grupos anunciaram em 30 dias (cada grupo conta uma vez por dia). Boa só sai se também for o menor preço do mês; ótima sai sempre. O mesmo perfume não repete em {data.rules.repeatHours}h, a não ser que fique 5% mais barato.
        </p>

        <div>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
            <TrendingDown className="size-4 text-muted-foreground" /> Simulação das últimas 48h: {data.sim.total} de {data.sim.checked.toLocaleString("pt-BR")} promoções passariam
          </div>
          <ul className="divide-y rounded-lg border text-[12.5px]">
            {data.sim.deals.slice(0, 12).map((d, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <Badge tone={d.label === "otima" ? "success" : "info"}>{d.label === "otima" ? "Ótima" : "Boa"} −{d.pct}%</Badge>
                <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                <span className="tabular-nums">R$ {brl(d.price)} <span className="text-muted-foreground">(normal R$ {brl(d.ref)})</span></span>
                <span className="text-muted-foreground">{d.group} · {timeAgo(d.at)}</span>
              </li>
            ))}
            {!data.sim.deals.length && <li className="px-3 py-2 text-muted-foreground">Nenhuma promoção passaria com essas regras.</li>}
          </ul>
        </div>

        {data.group && (
          <div>
            <div className="mb-2 text-[13px] font-medium">Posts do grupo de ofertas</div>
            <ul className="divide-y rounded-lg border text-[12.5px]">
              {data.posts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <Badge tone={p.status === "sent" ? "success" : p.status === "skipped" || p.status === "failed" ? "neutral" : "warning"}>{STATUS[p.status] || p.status}</Badge>
                  <span className="min-w-0 flex-1 truncate font-medium">#{p.id} {p.name}</span>
                  <span className="tabular-nums">R$ {brl(p.price)} <span className="text-muted-foreground">(normal R$ {brl(p.ref)})</span></span>
                  <span className="text-muted-foreground">{timeAgo(p.created_at)}</span>
                </li>
              ))}
              {!data.posts.length && <li className="px-3 py-2 text-muted-foreground">Ainda nada. Aparece aqui quando a próxima oferta boa chegar.</li>}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
