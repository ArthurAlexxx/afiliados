import type { Settings } from "./settings.ts";

/** Cliente mínimo da Evolution API v2. */
export class Evolution {
  constructor(private s: Pick<Settings, "evolutionUrl" | "evolutionApiKey" | "evolutionInstance">) {}

  get configured() {
    return Boolean(this.s.evolutionUrl && this.s.evolutionApiKey && this.s.evolutionInstance);
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.configured) throw new Error("Evolution API não configurada (URL, API key e instância).");
    const base = this.s.evolutionUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { apikey: this.s.evolutionApiKey, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* resposta não-JSON */
    }
    if (!res.ok) {
      throw new Error(`Evolution ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return json as T;
  }

  private get inst() {
    return encodeURIComponent(this.s.evolutionInstance);
  }

  connectionState() {
    return this.call<{ instance?: { state?: string } }>("GET", `/instance/connectionState/${this.inst}`);
  }

  /** Gera QR code (base64) e, se informar o número, código de pareamento. */
  connect(number?: string) {
    const q = number ? `?number=${encodeURIComponent(number.replace(/\D/g, ""))}` : "";
    return this.call<{ base64?: string; code?: string; pairingCode?: string; count?: number; instance?: { state?: string } }>(
      "GET",
      `/instance/connect/${this.inst}${q}`,
    );
  }

  createInstance(number?: string) {
    return this.call<{ qrcode?: { base64?: string; code?: string; pairingCode?: string } }>("POST", "/instance/create", {
      instanceName: this.s.evolutionInstance,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      ...(number ? { number: number.replace(/\D/g, "") } : {}),
      groupsIgnore: false,
    });
  }

  logout() {
    return this.call("DELETE", `/instance/logout/${this.inst}`);
  }

  fetchAllGroups() {
    return this.call<{ id: string; subject: string; size?: number }[]>(
      "GET",
      `/group/fetchAllGroups/${this.inst}?getParticipants=false`,
    );
  }

  /** Mensagens guardadas pela Evolution para um chat (mais recentes primeiro). */
  async findMessages(remoteJid: string, limit = 50, page = 1) {
    const r = await this.call<unknown>("POST", `/chat/findMessages/${this.inst}`, {
      where: { key: { remoteJid } },
      limit,
      offset: limit,
      page,
    });
    const any = r as { messages?: { records?: unknown[] } | unknown[] };
    const list = Array.isArray(r) ? r : Array.isArray(any.messages) ? any.messages : any.messages?.records || [];
    return list as Record<string, unknown>[];
  }

  /** Mensagens de um grupo a partir de um horário (segundos), página a página. */
  async findMessagesSince(remoteJid: string, sinceSec: number, limit = 250, page = 1) {
    const r = await this.call<unknown>("POST", `/chat/findMessages/${this.inst}`, {
      where: { key: { remoteJid }, messageTimestamp: { gte: new Date(sinceSec * 1000).toISOString() } },
      limit,
      offset: limit,
      page,
    });
    const any = r as { messages?: { records?: unknown[]; pages?: number } | unknown[] };
    const list = Array.isArray(r) ? r : Array.isArray(any.messages) ? any.messages : any.messages?.records || [];
    const pages = !Array.isArray(any.messages) && any.messages?.pages ? any.messages.pages : 1;
    return { list: list as Record<string, unknown>[], pages };
  }

  /** Conversas do número (contatos e grupos), com a última mensagem quando a Evolution manda. */
  async findChats() {
    const r = await this.call<unknown>("POST", `/chat/findChats/${this.inst}`, {});
    return (Array.isArray(r) ? r : []) as Record<string, unknown>[];
  }

  sendText(number: string, text: string) {
    return this.call("POST", `/message/sendText/${this.inst}`, { number, text, linkPreview: true });
  }

  sendImage(number: string, base64: string, mimetype: string, caption: string) {
    return this.call("POST", `/message/sendMedia/${this.inst}`, {
      number,
      mediatype: "image",
      mimetype,
      caption,
      media: base64,
      fileName: `promo.${mimetype.split("/")[1] || "jpg"}`,
    });
  }

  getBase64FromMediaMessage(messageId: string) {
    return this.call<{ base64?: string; mimetype?: string }>("POST", `/chat/getBase64FromMediaMessage/${this.inst}`, {
      message: { key: { id: messageId } },
      convertToMp4: false,
    });
  }

  /** URL da foto de perfil de um contato ou grupo (jid). */
  async profilePictureUrl(jid: string): Promise<string | null> {
    const r = await this.call<{ profilePictureUrl?: string | null }>("POST", `/chat/fetchProfilePictureUrl/${this.inst}`, { number: jid });
    return r.profilePictureUrl || null;
  }

  setWebhook(url: string) {
    return this.call("POST", `/webhook/set/${this.inst}`, {
      webhook: {
        enabled: true,
        url,
        webhookByEvents: false,
        webhookBase64: true,
        events: ["MESSAGES_UPSERT"],
      },
    });
  }

  findWebhook() {
    return this.call<{ url?: string; enabled?: boolean }>("GET", `/webhook/find/${this.inst}`);
  }
}
