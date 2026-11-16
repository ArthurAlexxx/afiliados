# Afiliados · Robô de promoções do WhatsApp

Captura promoções dos grupos de WhatsApp que você acompanha, troca os links do Mercado Livre pelo **seu link de afiliado (já encurtado)**, reformata no padrão do seu grupo e posta no seu grupo, tudo pela **Evolution API**. Vem com um painel web para configurar e acompanhar.

```
Grupos de origem ──(webhook MESSAGES_UPSERT)──▶ Painel ──▶ converte link ML ──▶ template ──▶ fila ──▶ Evolution API ──▶ Seu grupo
```

## O que ele faz

- **Captura**: recebe as mensagens dos grupos marcados como *Origem* via webhook da Evolution API (texto, legenda de imagem, imagem).
- **Troca de link**: encontra links do Mercado Livre (inclusive `meli.la`, `mercadolivre.com/sec/...` e links de afiliado de outras pessoas), descobre o produto (MLB) e gera o **seu** link.
  - *Gerador oficial* (recomendado): usa o Gerador de Links do portal de afiliados com o cookie da sua sessão e devolve o link curto oficial.
  - *Parâmetros + encurtador*: monta `?matt_word=SUA_TAG&matt_tool=SEU_ID` e encurta (TinyURL, is.gd ou Bitly).
- **Formatação**: extrai título, preço, preço antigo, desconto, cupom, frete e parcelamento e aplica o seu template. Linhas com variável vazia somem sozinhas. IA (Claude) opcional para mensagens bagunçadas.
- **Regras**: só ML, remove links de outras lojas, palavras bloqueadas, anti-duplicado por produto, intervalo mínimo entre posts, janela de horário, modo automático ou com aprovação manual.
- **Envio**: posta no(s) grupo(s) *Destino* com a imagem original (ou a foto do anúncio).
- **Painel**: conexão do WhatsApp por QR code ou código de pareamento, visão geral, fila (aprovar, editar, enviar agora, descartar), grupos, template com pré-visualização estilo WhatsApp, integrações e logs. Tema claro/escuro, mobile.

## Curadoria (modo padrão)

Em vez de repostar tudo, o robô transforma os grupos de origem numa base de preços e fotos e posta só o melhor:

- **Mesmo perfume entre grupos**: cada grupo usa o próprio link de afiliado, então o perfume é identificado pelo nome normalizado (linha + ml + concentração, sem marca e palavras genéricas). Ex: "Perfume Jean Paul Gaultier Le Male Elixir Parfum 75 ml Masculino" = "JPG Le Male Elixir Parfum 75ml".
- **Ranking**: nota por quantos grupos postam o perfume, preço "Por" contra a média do próprio perfume (o "De" costuma ser inflado), se está bombando agora e o desconto informado. Não repete o mesmo perfume dentro do intervalo configurado.
- **Banco de fotos**: guarda as fotos dos grupos **sem marca d'água** (alta resolução, fundo produzido ganha nota maior, fotos repetidas ficam só na melhor versão). Grupos marcados com marca d'água contribuem só com a promoção.
- **Etiquetas**: a foto escolhida recebe duas etiquetas de vidro (glassmorphism): o desconto embaixo à esquerda e o grupo (foto, nome, @ do Instagram) em cima à direita.
- **Link**: o link da melhor oferta é trocado pelo seu link de afiliado. Se não der para converter, o post fica em *Aprovar* e nada é enviado.

Configuração inicial automática por variáveis (regex no nome do grupo, aplicada uma vez): `AUTO_SOURCE_GROUPS`, `AUTO_DEST_GROUP`, `AUTO_WATERMARK_GROUPS`. Depois disso o histórico dos grupos de origem é importado sozinho. Tudo pode ser ajustado nas telas **Curadoria** e **Grupos**.

## Rodando no seu computador

Requisitos: **Node.js 22.13+** (usa o SQLite embutido do Node, sem instalar banco).

```bash
npm install
cp .env.example .env      # preencha pelo menos ADMIN_PASSWORD
npm run dev               # http://localhost:3000
```

Para a Evolution API conseguir chamar o webhook no seu PC, exponha a porta com um túnel (ex: `cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000`) e use essa URL como **URL pública** no painel.

Produção local: `npm run build && npm start`.

## Passo a passo de configuração (no painel)

1. Defina `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_INSTANCE` no `.env` (ou nas variáveis da Railway). Instância e webhook são criados sozinhos.
2. **Conectar WhatsApp**: gere o QR code (ou o código de pareamento com o seu número) e leia no WhatsApp Business em *Dispositivos conectados → Conectar dispositivo*. Se a instância ainda não existir na Evolution, o painel cria. O QR se renova sozinho até conectar.
3. Para receber mensagens rodando no seu PC, defina `PUBLIC_URL` com a URL de um túnel. Na Railway isso é automático.
4. **Mercado Livre Afiliados**: escolha a estratégia.
   - *Gerador oficial*: logado em mercadolivre.com.br/afiliados, abra o DevTools (F12) → aba Rede → gere um link qualquer → clique na requisição `createLink` → copie o cabeçalho **Cookie** (e o `x-csrf-token`, se houver) e cole no painel. Quando o cookie expirar, os links começam a falhar e as promoções vão para *Aprovar*. É só colar um cookie novo.
   - *Parâmetros*: informe sua etiqueta (`matt_word`) e o `matt_tool` (aparecem nos links que você gera no portal) e escolha um encurtador.
5. **Grupos → Sincronizar grupos** e marque cada grupo como *Origem* (de onde copiar) ou *Destino* (o seu grupo).
6. **Template e teste**: ajuste o padrão da mensagem, cole uma promoção real e use *Testar com links reais* para ver a conversão sem enviar nada.
7. Ajuste as **Regras de envio** (intervalo, horário, modo manual/automático).

Tudo que é salvo no painel tem prioridade sobre o `.env`.

### Variáveis do template

| Variável | Conteúdo |
|---|---|
| `{titulo}` | Nome do produto |
| `{preco}` / `{preco_antigo}` | Preços (formato 1.234,56) |
| `{desconto}` | Ex: `(-25%)`, calculado dos preços |
| `{cupom}` / `{frete}` / `{parcelamento}` | Quando existirem na mensagem |
| `{link}` | Seu link de afiliado encurtado |
| `{links}` | Todos os seus links, um por linha |
| `{texto}` | Mensagem original com os links já trocados |
| `{grupo_origem}` / `{loja}` | Nome do grupo de origem / "Mercado Livre" |

`{var}` remove a linha inteira quando vazia; `{var?}` some só ela e mantém a linha.

## Deploy na Railway (recomendado)

O painel roda no mesmo projeto da Railway que a Evolution API e se configura sozinho:

1. Crie um serviço a partir deste repositório (a Railway usa o `Dockerfile`).
2. Anexe um volume em `/app/data` (banco e imagens).
3. Variáveis do serviço:
   - `EVOLUTION_API_URL` = `https://${{Evolution API.RAILWAY_PUBLIC_DOMAIN}}`
   - `EVOLUTION_API_KEY` = `${{Evolution API.AUTHENTICATION_API_KEY}}`
   - `EVOLUTION_INSTANCE` = nome da instância (ex: `Celular1`)
   - `ADMIN_PASSWORD` = senha do painel
   - `DATA_DIR` = `/app/data`
4. Gere um domínio público para o serviço (porta 3000).

Na inicialização (e a cada 10 min) o painel cria a instância na Evolution se ela não existir e aponta o webhook para o próprio domínio (`RAILWAY_PUBLIC_DOMAIN`), com token gerado automaticamente. Só falta abrir **Conectar WhatsApp** e ler o QR code.

## Deploy em outro lugar

O painel precisa ficar **sempre ligado** (recebe webhook e tem um worker que envia a fila a cada 15s) e com **disco persistente** para o SQLite. Bons lugares: uma VPS (a mesma da Evolution API), Railway ou Render com volume. Vercel/serverless **não** serve.

Com Docker:

```bash
cp .env.example .env   # preencha
docker compose up -d --build
```

O volume `afiliados-data` guarda o banco (`/app/data/afiliados.db`) e as imagens.

## Endpoints úteis

- `POST /api/webhook/evolution?token=SEU_TOKEN` · webhook da Evolution (também aceita `/api/webhook/evolution/messages-upsert`).
- `POST /api/queue` · força uma rodada da fila (logado).
- `GET /api/health` · health check.

## Testes

- `npm test` · testa o parser e o template com mensagens de exemplo.
- `node scripts/mock-evolution.mjs` · sobe uma Evolution API falsa em `http://localhost:8081` (API key `teste`) para testar o fluxo inteiro sem WhatsApp: configure essa URL no painel, sincronize os grupos e mande um POST no webhook.

Exemplo de evento para testar o webhook:

```bash
curl -X POST "http://localhost:3000/api/webhook/evolution?token=SEU_TOKEN" \
  -H "content-type: application/json" \
  -d '{"event":"messages.upsert","data":{"key":{"remoteJid":"111@g.us","id":"TESTE1"},"message":{"conversation":"Air Fryer Mondial 4L\nDe R$ 399,90 por R$ 229,90\nhttps://www.mercadolivre.com.br/p/MLB19500111"}}}'
```

## Estrutura

```
src/
  app/(painel)/        páginas do painel (visão geral, fila, grupos, template, configurações, logs)
  app/api/             rotas (webhook, posts, grupos, settings, preview, evolution, stats)
  lib/pipeline.ts      captura → conversão → template → fila → envio
  lib/affiliate.ts     troca de link do Mercado Livre e encurtadores
  lib/parser.ts        extração de preço/cupom/título e renderização do template
  lib/evolution.ts     cliente da Evolution API v2
  lib/db.ts            SQLite (node:sqlite)
  components/          UI (sidebar baseada no componente "Sidebar" do 21st.dev, cards, preview do WhatsApp)
```

## Observações

- O Mercado Livre não tem API pública para links de afiliado; a estratégia *Gerador* usa o mesmo endpoint do portal. Se o ML mudar esse endpoint, ajuste `MELI_CREATE_LINK_URL` ou use a estratégia de parâmetros.
- Respeite um intervalo razoável entre posts para não ter o número bloqueado pelo WhatsApp.
