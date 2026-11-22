"use client";

import * as React from "react";
import { BookA, Link2, Search, Tags } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/client";

type Row = {
  id: number; name: string; ml: number; concLabel: string | null; frag_name: string | null; frag_brand: string | null; frag_url: string | null;
  aliases: { title: string; hits: number }[]; meli: { meli_id: string; hits: number }[];
};

export default function NomesPage() {
  const [q, setQ] = React.useState("");
  const [deb, setDeb] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDeb(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useApi<{ rows: Row[]; totals: { products: number; aliases: number; meli: number } }>(`/api/nomes?q=${encodeURIComponent(deb)}`);

  return (
    <>
      <PageHeader title="Nomes dos perfumes" description="Cada perfume com todos os jeitos que os grupos escrevem o nome. Tamanho e concentração (EDP, EDT, Parfum…) nunca se misturam." />
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: "Perfumes", value: data?.totals.products, icon: BookA },
          { label: "Nomes aprendidos", value: data?.totals.aliases, icon: Tags },
          { label: "Anúncios do ML ligados", value: data?.totals.meli, icon: Link2 },
        ].map((k) => (
          <Card key={k.label} className="flex items-center gap-3 p-4">
            <span className="hidden size-9 items-center justify-center rounded-lg bg-muted sm:flex">
              <k.icon className="size-4 text-muted-foreground" />
            </span>
            <div>
              <div className="text-[20px] leading-none font-semibold tabular-nums">{k.value?.toLocaleString("pt-BR") ?? "—"}</div>
              <div className="mt-1 text-[12px] text-muted-foreground">{k.label}</div>
            </div>
          </Card>
        ))}
      </div>
      <div className="relative mb-4">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por qualquer nome (ex: cdn intense, asad, sauvage elixir)" className="pl-9" />
      </div>
      <div className="space-y-3">
        {data?.rows.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold">{r.frag_name || r.name}</span>
              <Badge tone="neutral">{r.ml}ml</Badge>
              {r.concLabel && <Badge tone="accent">{r.concLabel}</Badge>}
              {r.frag_brand && <span className="text-[12px] text-muted-foreground">{r.frag_brand}</span>}
              <span className="ml-auto text-[11.5px] text-muted-foreground">
                {r.aliases.length} nome(s){r.meli.length ? ` · ${r.meli.length} anúncio(s) do ML` : ""}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.aliases.map((a) => (
                <span key={a.title} className="rounded-md bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground">
                  {a.title} <b className="tabular-nums">×{a.hits}</b>
                </span>
              ))}
            </div>
          </Card>
        ))}
        {data && !data.rows.length && <p className="text-[13px] text-muted-foreground">Nenhum perfume com esse nome.</p>}
      </div>
    </>
  );
}
