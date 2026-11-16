"use client";

import * as React from "react";
import Link from "next/link";
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
        <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-muted">
            <Plug className="size-4 text-muted-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              WhatsApp (Evolution API)
              <Badge tone={connected ? "success" : evo?.configured ? "warning" : "danger"} dot>
                {connected ? "Conectado" : evo?.configured ? "Aguardando QR code" : "Não configurado"}
              </Badge>
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Configurado automaticamente: instância, credenciais e webhook já ficam prontos.
            </p>
          </div>
          <Link href="/conexao">
            <Button size="sm" variant="outline">{connected ? "Ver conexão" : "Conectar WhatsApp"}</Button>
          </Link>
        </Card>

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

        <Section icon={ShieldCheck} title="Regras de envio" description="Limites que o agente sempre respeita. Post sem o nosso link nunca sai.">
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
          <div className="flex flex-col gap-4 rounded-xl border p-4 sm:col-span-2">
            <Switch checked={bool("requireMeliLink")} onChange={set("requireMeliLink")} label="Só postar promoções do Mercado Livre" description="Mensagens sem link do ML são ignoradas." />
            <Switch checked={bool("sendImage")} onChange={set("sendImage")} label="Enviar com imagem" description="Posta com a melhor foto do perfume (quadrada, sem marca d\'água) e as nossas etiquetas." />
            <Switch checked={bool("fetchProductImage")} onChange={set("fetchProductImage")} label="Buscar foto do produto" description="Quando a mensagem original vier sem imagem, usa a foto do anúncio." />
            <Switch checked={bool("ignoreFromMe")} onChange={set("ignoreFromMe")} label="Ignorar mensagens enviadas pelo próprio número" />
          </div>
          <Field label="Palavras bloqueadas" className="sm:col-span-2" hint="Uma por linha. Promoções com essas palavras são ignoradas (ex: shopee, amazon, +18).">
            <Textarea value={str("blocklist")} onChange={(e) => set("blocklist")(e.target.value)} className="min-h-20" />
          </Field>
        </Section>

        <Section icon={Sparkles} title="Agente" description="Ele decide sozinho o que sai no grupo: olha o hype nos outros grupos, o histórico de preço e o que já postamos.">
          <Field label="Chave do Claude (Anthropic)" hint="Com a chave, o Claude dá a palavra final em cada post. Sem ela, o agente decide só pelas regras.">
            <Input type="password" value={str("anthropicApiKey")} onChange={(e) => set("anthropicApiKey")(e.target.value)} placeholder="sk-ant-..." />
          </Field>
          <Field label="Modelo">
            <Input value={str("aiModel")} onChange={(e) => set("aiModel")(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Switch checked={bool("aiEnabled")} onChange={set("aiEnabled")} label="Usar o Claude também para ler mensagens bagunçadas" description="Melhora título, preço e cupom quando o grupo escreve fora do padrão." />
          </div>
        </Section>

        <Section icon={Sparkles} title="Imagens com IA" description="Refaz fotos de grupos com marca d'água (só o canto da marca) para perfumes com poucas fotos. Tudo passa pela sua aprovação na tela Imagens.">
          <Field label="Chave da OpenAI" hint="Usada só para refazer as fotos. Cada foto é uma chamada paga (qualidade média).">
            <Input type="password" value={str("openaiApiKey")} onChange={(e) => set("openaiApiKey")(e.target.value)} placeholder="sk-..." />
          </Field>
          <Field label="Modelo de imagem">
            <Input value={str("imageModel")} onChange={(e) => set("imageModel")(e.target.value)} />
          </Field>
          <Field label="Máximo de fotos por dia" hint="Limite de gasto: depois disso a fila espera o dia seguinte.">
            <Input type="number" value={str("imageFixDaily") || "15"} onChange={(e) => set("imageFixDaily")(Number(e.target.value))} />
          </Field>
          <div className="sm:col-span-2">
            <Switch checked={bool("imageFixEnabled")} onChange={set("imageFixEnabled")} label="Refazer fotos com marca d'água" description="Na tela Grupos, marque o canto onde cada grupo põe a marca (padrão: superior direito)." />
          </div>
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
