FROM node:24-bookworm-slim
RUN apt-get -o Acquire::ForceIPv4=true -o Acquire::http::Timeout=20 -o Acquire::Retries=1 update && apt-get -o Acquire::ForceIPv4=true -o Acquire::http::Timeout=20 -y --no-install-recommends install ffmpeg ca-certificates python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node *.mjs ./
COPY --chown=node:node normalize-tts.py ./
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data PATH=/opt/venv/bin:$PATH
CMD ["node", "server.mjs"]
