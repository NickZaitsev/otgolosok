FROM node:24-bookworm-slim
RUN apt-get -o Acquire::ForceIPv4=true -o Acquire::http::Timeout=20 -o Acquire::Retries=1 update && apt-get -o Acquire::ForceIPv4=true -o Acquire::http::Timeout=20 -y --no-install-recommends install ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node *.mjs ./
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
CMD ["node", "server.mjs"]
