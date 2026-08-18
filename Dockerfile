# Node 22 LTS, a mesma linha usada no desenvolvimento.
# Duas etapas: a primeira compila better-sqlite3 e baixa os binarios do sharp,
# a segunda fica so com o resultado — a imagem final nao carrega compilador.

FROM node:22-bookworm-slim AS dependencias

WORKDIR /app

# better-sqlite3 compila codigo nativo; sharp baixa binario pre-compilado.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copia so os manifestos primeiro: enquanto as dependencias nao mudarem, o
# Docker reaproveita esta camada e o build seguinte nao recompila nada.
COPY package.json package-lock.json ./

# --omit=dev deixa de fora o gerador de QR code, que e ferramenta de bancada e
# nao tem por que existir no servidor.
RUN npm ci --omit=dev


FROM node:22-bookworm-slim AS producao

WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencias /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY publico ./publico
COPY privado ./privado

# A imagem node ja traz o usuario "node" sem privilegio. O diretorio de dados
# e criado e entregue a ele antes da troca, senao o processo nao consegue
# gravar no volume.
RUN mkdir -p /app/dados && chown -R node:node /app

USER node

EXPOSE 3000

# Sem npm no meio: o node vira PID 1 e recebe o SIGTERM do Docker direto,
# que e o que dispara o encerramento limpo do banco em src/servidor.js.
CMD ["node", "src/servidor.js"]
