FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p data && npm run build

FROM node:22-alpine
WORKDIR /app
# fontes para as etiquetas desenhadas nas fotos (sharp/librsvg usa o fontconfig)
RUN apk add --no-cache fontconfig font-inter font-dejavu || apk add --no-cache fontconfig ttf-dejavu
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/app/data PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
