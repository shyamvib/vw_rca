# RCA analytics service (engine/server.ts). Build from the repo root:
#   docker build -f engine/deploy/Dockerfile -t rca-engine .
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
 && chmod +x /usr/local/bin/cloudflared \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY analytics ./analytics
COPY engine/*.ts ./engine/
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "--import", "tsx", "engine/server.ts"]
