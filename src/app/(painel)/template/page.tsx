"use client";

import * as React from "react";
import { toast } from "sonner";
import { Save, RotateCcw, Wand2, Globe, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { WaPreview } from "@/components/wa-preview";
import { api, useApi } from "@/lib/client";
import { DEFAULT_TEMPLATE, TEMPLATE_VARS, parsePromo, renderTemplate } from "@/lib/parser";

const SAMPLE = `📉 Baixou 43%

Asad Eau de Parfum 100ml

❌ DE: R$299,00
✅ POR: R$169,00 (frete grátis)

🎟️ CUPOM: DEZOFF

🛒 Vendido por KID'S LIFE

https://mercadolivre.com/sec/1aBcDeF`;

type PreviewResult = {
  formatted: string;
  status: string;
  reason: string | null;
  productImage?: string | null;
  conversions: { original: string; ok: boolean; affiliateUrl?: string; error?: string; productKey?: string }[];
};

export default function TemplatePage() {
  const { data: settings } = useApi<{ template: string }>("/api/settings");
  const [tpl, setTpl] = React.useState<string | null>(null);
  const [sample, setSample] = React.useState(SAMPLE);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [online, setOnline] = React.useState<PreviewResult | null>(null);
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (settings && tpl === null) setTpl(settings.template);
  }, [settings, tpl]);

  const template = tpl ?? "";
  const local = React.useMemo(() => {
    const data = { ...parsePromo(sample), link: "https://meli.la/SEU-LINK", links: "https://meli.la/SEU-LINK", texto: sample, grupo_origem: "Grupo de teste", loja: "Mercado Livre" };
    return { text: renderTemplate(template, data), data };
  }, [template, sample]);

  const insert = (v: string) => {
    const el = ref.current;
    const token = `{${v}}`;
    if (!el) return setTpl(template + token);
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    setTpl(template.slice(0, start) + token + template.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/settings", { method: "PUT", json: { template } });
      toast.success("Template salvo");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const testOnline = async () => {
    setTesting(true);
    setOnline(null);
    try {
      const r = await api<PreviewResult>("/api/preview", { method: "POST", json: { text: sample, template } });
      setOnline(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Template e teste"
        description="Padrão dos posts que o agente publica. Simule com qualquer mensagem dos grupos."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setTpl(DEFAULT_TEMPLATE)}>
              <RotateCcw className="size-3.5" /> Padrão
            </Button>
            <Button size="sm" onClick={save} loading={saving}>
              {!saving && <Save className="size-3.5" />} Salvar template
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Template"
              description={
                <>
                  Linhas com uma variável vazia somem sozinhas. Use <code className="rounded bg-muted px-1">{"{var?}"}</code> para variável opcional
                  dentro da linha. Formatação do WhatsApp: *negrito*, _itálico_, ~riscado~.
                </>
              }
            />
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARS.map((v) => (
                  <button
                    key={v.key}
                    title={v.label}
                    onClick={() => insert(v.key)}
                    className="rounded-lg border bg-background px-2 py-1 font-mono text-[11.5px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                  >
                    {`{${v.key}}`}
                  </button>
                ))}
              </div>
              <Textarea ref={ref} value={template} onChange={(e) => setTpl(e.target.value)} className="min-h-72 font-mono text-[12.5px]" spellCheck={false} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Mensagem de exemplo" description="Cole aqui uma promoção real de um dos grupos de origem." />
            <CardContent className="flex flex-col gap-3">
              <Textarea value={sample} onChange={(e) => setSample(e.target.value)} className="min-h-48 text-[13px]" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={testOnline} loading={testing}>
                  {!testing && <Globe className="size-3.5" />} Testar com links reais
                </Button>
                <span className="self-center text-[12px] text-muted-foreground">Converte os links de verdade, sem enviar nada.</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-0 lg:self-start">
          <Card>
            <CardHeader
              title="Pré-visualização"
              description="Atualiza enquanto você digita (link fictício)."
              action={<Wand2 className="size-4 text-muted-foreground" />}
            />
            <CardContent>
              <WaPreview text={local.text} />
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                {(["titulo", "preco", "preco_antigo", "desconto", "cupom", "frete", "parcelamento"] as const).map((k) => (
                  <div key={k} className="flex min-w-0 gap-2">
                    <span className="shrink-0 font-mono text-muted-foreground">{k}</span>
                    <span className="truncate font-medium">{local.data[k] || <span className="text-muted-foreground/60">—</span>}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {online && (
            <Card>
              <CardHeader title="Resultado com links reais" action={<StatusBadge status={online.status} />} />
              <CardContent className="flex flex-col gap-3">
                {online.reason && <div className="rounded-xl bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">{online.reason}</div>}
                <WaPreview text={online.formatted} image={online.productImage} />
                {online.conversions.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {online.conversions.map((c, i) => (
                      <li key={i} className="flex gap-2 rounded-xl border px-3 py-2 text-[12px]">
                        {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                        <div className="min-w-0">
                          <div className="truncate text-muted-foreground">{c.original}</div>
                          <div className="truncate font-medium">{c.ok ? c.affiliateUrl : c.error}</div>
                          {c.productKey && <div className="font-mono text-[11px] text-muted-foreground">{c.productKey}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
