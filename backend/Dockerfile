FROM node:24-bookworm-slim
RUN apt-get -o Acquire::ForceIPv4=true -o Acquire::http::Timeout=20 -o Acquire::Retries=1 update && apt-get -o Acquire::ForceIPv4=true -o Acquire::http::Timeout=20 -y --no-install-recommends install ffmpeg ca-certificates python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY vendor/softmg-airouter-logs-0.1.0.tgz ./vendor/
RUN npm install --omit=dev --no-audit --no-fund ./vendor/softmg-airouter-logs-0.1.0.tgz
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node backend/*.mjs ./
COPY --chown=node:node backend/normalize-tts.py ./
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data PATH=/opt/venv/bin:$PATH
CMD ["node", "server.mjs"]
