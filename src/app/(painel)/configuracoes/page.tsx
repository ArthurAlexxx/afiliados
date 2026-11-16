"use client";

import * as React from "react";
import { toast } from "sonner";
import { Save, Plug, Webhook, Copy, ShoppingBag, Link2, ShieldCheck, Sparkles, Info } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { api, useApi } from "@/lib/client";

type S = Record<string, string | number | boolean>;

type EvoStatus = { configured: boolean; state?: string; error?: string; webhookUrl: string; webhook?: { url?: string; enabled?: boolean } };

function Section({ icon: Icon, title, description, children, action }: { icon: React.ElementType; title: string; description: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-[9px] bg-muted">
              <Icon className="size-3.5 text-muted-foreground" />
            </span>
            {title}
          </span>
        }
        description={description}
        action={action}
      />
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

const SHOW_EVOLUTION_SETTINGS = false;

export default function ConfigPage() {
  const { data, setData } = useApi<S>("/api/settings");
  const { data: evo, reload: reloadEvo } = useApi<EvoStatus>("/api/evolution");
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const set = (k: string) => (v: string | number | boolean) => {
    setData((d) => (d ? { ...d, [k]: v } : d));
    setDirty(true);
  };
  const str = (k: string) => String(data?.[k] ?? "");
  const bool = (k: string) => Boolean(data?.[k]);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const out = await api<S>("/api/settings", {
        method: "PUT",
        json: { ...data, dedupHours: Number(data.dedupHours), minIntervalSeconds: Number(data.minIntervalSeconds) },
      });
      setData(out);
      setDirty(false);
      toast.success("Configurações salvas");
      reloadEvo();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const evoAction = async (action: string) => {
    setBusy(action);
    try {
      if (dirty) await save();
      const r = await api<{ url?: string }>("/api/evolution", { method: "POST", json: { action } });
      toast.success(action === "setWebhook" ? `Webhook configurado: ${r.url}` : "OK");
      reloadEvo();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <div className="h-96 animate-pulse rounded-2xl bg-muted" />;

  const connected = evo?.state === "open";

  return (
    <>
      <PageHeader
        title="Integrações e regras"
        description="Seu link de afiliado e as regras de envio."
        actions={
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            {!saving && <Save className="size-3.5" />} Salvar alterações
          </Button>
        }
      />

      <div className="flex flex-col gap-4 pb-20">
        {/* Evolution API já vem configurada (Railway). Mude SHOW_EVOLUTION_SETTINGS para true para editar pelo painel. */}
        {SHOW_EVOLUTION_SETTINGS && (
        <Section
          icon={Plug}
          title="Evolution API"
          description="Instância do WhatsApp Business que lê os grupos e posta no seu grupo."
          action={
            evo?.configured ? (
              <Badge tone={connected ? "success" : "danger"} dot>
                {connected ? "Conectado" : evo.error ? "Erro" : evo.state || "Desconectado"}
              </Badge>
            ) : (
              <Badge tone="warning" dot>Não configurado</Badge>
            )
          }
        >
          <Field label="URL da Evolution API" hint="Ex: https://evolution.seudominio.com">
            <Input value={str("evolutionUrl")} onChange={(e) => set("evolutionUrl")(e.target.value)} placeholder="https://..." />
          </Field>
          <Field label="Nome da instância">
            <Input value={str("evolutionInstance")} onChange={(e) => set("evolutionInstance")(e.target.value)} placeholder="minha-instancia" />
          </Field>
          <Field label="API key" hint="Global ou da instância. Fica salva só no servidor.">
            <Input type="password" value={str("evolutionApiKey")} onChange={(e) => set("evolutionApiKey")(e.target.value)} placeholder="••••" />
          </Field>
          <Field label="URL pública deste painel" hint="Usada para montar o webhook. Ex: https://afiliados.seudominio.com">
            <Input value={str("publicUrl")} onChange={(e) => set("publicUrl")(e.target.value)} placeholder="https://..." />
          </Field>
          <Field label="Token do webhook" hint="Qualquer texto secreto. Impede que outras pessoas chamem seu webhook.">
            <Input value={str("webhookToken")} onChange={(e) => set("webhookToken")(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">URL do webhook</span>
            <div className="flex gap-2">
              <Input readOnly value={evo?.webhookUrl || "Preencha a URL pública"} className="font-mono text-[12px]" />
              <Button
                size="icon"
                variant="outline"
                className="size-9"
                title="Copiar"
                onClick={() => evo?.webhookUrl && navigator.clipboard.writeText(evo.webhookUrl).then(() => toast.success("Copiado"))}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            <span className="text-[12px] text-muted-foreground">
              {evo?.webhook?.url ? (evo.webhook.url === evo.webhookUrl ? "✓ Webhook já aponta para cá" : `Webhook atual: ${evo.webhook.url}`) : "Evento necessário: MESSAGES_UPSERT"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button size="sm" variant="outline" onClick={() => reloadEvo()}>
              <Plug className="size-3.5" /> Testar conexão
            </Button>
            <Button size="sm" variant="outline" onClick={() => evoAction("setWebhook")} loading={busy === "setWebhook"}>
              {busy !== "setWebhook" && <Webhook className="size-3.5" />} Configurar webhook automaticamente
            </Button>
            {evo?.error && <span className="self-center text-[12px] text-danger">{evo.error}</span>}
          </div>
        </Section>
        )}

        <Section icon={ShoppingBag} title="Mercado Livre Afiliados" description="Como transformar os links das promoções no SEU link de afiliado.">
          <Field
            label="Estratégia"
            className="sm:col-span-2"
            hint={
              str("meliStrategy") === "generator"
                ? "Usa o Gerador de Links do portal de afiliados com o cookie da sua sessão. Gera o link curto oficial (meli.la / mercadolivre.com/sec)."
                : "Monta o link do produto com seus parâmetros de afiliado (matt_word / matt_tool) e encurta com o encurtador escolhido."
            }
          >
            <Select
              value={str("meliStrategy")}
              onChange={set("meliStrategy")}
              options={[
                { value: "generator", label: "Gerador oficial (link curto meli.la) · recomendado" },
                { value: "params", label: "Parâmetros de afiliado + encurtador" },
              ]}
            />
          </Field>
          <Field label="Sua etiqueta (tag) de afiliado" hint="A etiqueta que aparece no portal de afiliados.">
            <Input value={str("meliTag")} onChange={(e) => set("meliTag")(e.target.value)} placeholder="minhaloja" />
          </Field>
          {str("meliStrategy") === "generator" ? (
            <>
              <Field label="Token CSRF (opcional)" hint="Header x-csrf-token da requisição createLink, se o ML exigir.">
                <Input type="password" value={str("meliCsrf")} onChange={(e) => set("meliCsrf")(e.target.value)} />
              </Field>
              <Field
                label="Cookie da sessão do Mercado Livre"
                className="sm:col-span-2"
                hint="Logado no portal de afiliados, abra o DevTools (F12) → Rede → gere um link → copie o cabeçalho Cookie da requisição createLink. Renove se começar a falhar."
              >
                <Textarea value={str("meliCookie")} onChange={(e) => set("meliCookie")(e.target.value)} className="min-h-20 font-mono text-[12px]" placeholder="_d2id=...; ssid=...; orguseridp=..." />
              </Field>
            </>
          ) : (
            <>
              <Field label="matt_tool" hint="ID numérico da sua conta de afiliado (aparece nos seus links gerados).">
                <Input value={str("meliMattTool")} onChange={(e) => set("meliMattTool")(e.target.value)} placeholder="12345678" />
              </Field>
              <Field label="Parâmetros extras (opcional)" className="sm:col-span-2" hint="Ex: forceInApp=true&ref=...">
                <Input value={str("meliExtraParams")} onChange={(e) => set("meliExtraParams")(e.target.value)} />
              </Field>
            </>
          )}
        </Section>

        <Section icon={Link2} title="Encurtador" description="Usado na estratégia de parâmetros. O gerador oficial já devolve o link curto.">
          <Field label="Serviço">
            <Select
              value={str("shortener")}
              onChange={set("shortener")}
              options={[
                { value: "none", label: "Nenhum" },
                { value: "tinyurl", label: "TinyURL (sem chave)" },
                { value: "isgd", label: "is.gd (sem chave)" },
                { value: "bitly", label: "Bitly (precisa de token)" },
              ]}
            />
          </Field>
          {str("shortener") === "bitly" && (
            <Field label="Token do Bitly">
              <Input type="password" value={str("bitlyToken")} onChange={(e) => set("bitlyToken")(e.target.value)} />
            </Field>
          )}
        </Section>

        <Section icon={ShieldCheck} title="Regras de envio" description="Controle o que entra no grupo e o ritmo das postagens.">
          <Field label="Modo de envio">
            <Select
              value={str("sendMode")}
              onChange={set("sendMode")}
              options={[
                { value: "auto", label: "Automático (posta sozinho)" },
                { value: "manual", label: "Manual (eu aprovo cada post)" },
              ]}
            />
          </Field>
          <Field label="Intervalo mínimo entre posts (segundos)" hint="Evita flood e bloqueio do número. Recomendado: 60 a 180.">
            <Input type="number" min={0} value={str("minIntervalSeconds")} onChange={(e) => set("minIntervalSeconds")(e.target.value)} />
          </Field>
          <Field label="Postar a partir de">
            <Input type="time" value={str("activeFrom")} onChange={(e) => set("activeFrom")(e.target.value)} />
          </Field>
          <Field label="Postar até">
            <Input type="time" value={str("activeTo")} onChange={(e) => set("activeTo")(e.target.value)} />
          </Field>
          <Field label="Não repetir o mesmo produto por (horas)" hint="0 desliga a checagem de duplicados.">
            <Input type="number" min={0} value={str("dedupHours")} onChange={(e) => set("dedupHours")(e.target.value)} />
          </Field>
          <Field label="Links que não são do Mercado Livre">
            <Select
              value={str("otherLinks")}
              onChange={set("otherLinks")}
              options={[
                { value: "remove", label: "Remover (recomendado)" },
                { value: "keep", label: "Manter no texto" },
              ]}
            />
          </Field>
          <Field label="Se um link do ML não converter">
            <Select
              value={str("onConvertFail")}
              onChange={set("onConvertFail")}
              options={[
                { value: "pending", label: "Mandar para aprovação" },
                { value: "skip", label: "Ignorar a promoção" },
              ]}
            />
          </Field>
          <div className="flex flex-col gap-4 rounded-xl border p-4 sm:col-span-2">
            <Switch checked={bool("requireMeliLink")} onChange={set("requireMeliLink")} label="Só postar promoções do Mercado Livre" description="Mensagens sem link do ML são ignoradas." />
            <Switch checked={bool("sendImage")} onChange={set("sendImage")} label="Enviar com imagem" description="Reaproveita a imagem da mensagem original." />
            <Switch checked={bool("fetchProductImage")} onChange={set("fetchProductImage")} label="Buscar foto do produto" description="Quando a mensagem original vier sem imagem, usa a foto do anúncio." />
            <Switch checked={bool("ignoreFromMe")} onChange={set("ignoreFromMe")} label="Ignorar mensagens enviadas pelo próprio número" />
          </div>
          <Field label="Palavras bloqueadas" className="sm:col-span-2" hint="Uma por linha. Promoções com essas palavras são ignoradas (ex: shopee, amazon, +18).">
            <Textarea value={str("blocklist")} onChange={(e) => set("blocklist")(e.target.value)} className="min-h-20" />
          </Field>
        </Section>

        <Section icon={Sparkles} title="IA (opcional)" description="Usa o Claude para extrair título, preço e cupom de mensagens bagunçadas.">
          <div className="sm:col-span-2">
            <Switch checked={bool("aiEnabled")} onChange={set("aiEnabled")} label="Melhorar extração com IA" description="Sem IA, o parser automático já resolve a maioria dos formatos." />
          </div>
          {bool("aiEnabled") && (
            <>
              <Field label="Anthropic API key">
                <Input type="password" value={str("anthropicApiKey")} onChange={(e) => set("anthropicApiKey")(e.target.value)} placeholder="sk-ant-..." />
              </Field>
              <Field label="Modelo">
                <Input value={str("aiModel")} onChange={(e) => set("aiModel")(e.target.value)} />
              </Field>
            </>
          )}
        </Section>

        <div className="flex items-start gap-2 rounded-xl bg-muted px-4 py-3 text-[12.5px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          Valores definidos aqui têm prioridade sobre as variáveis de ambiente (.env). Campos secretos aparecem mascarados; deixe como está para manter o valor atual.
        </div>
      </div>

      {dirty && (
        <div className="fixed right-6 bottom-6 z-30">
          <Button onClick={save} loading={saving} className="shadow-lg">
            {!saving && <Save className="size-4" />} Salvar alterações
          </Button>
        </div>
      )}
    </>
  );
}
