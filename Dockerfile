FROM node:24.20.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# pnpm comes from the packageManager field in package.json, as in the backend image.
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The lockfile covers the video workspace package; its manifest is needed, its dependencies are not.
COPY video/package.json ./video/
COPY vendor/softmg-airouter-logs-0.1.0.tgz ./vendor/
RUN pnpm install --frozen-lockfile --filter otgolosok
COPY . .
RUN pnpm build

FROM nginx:stable-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/api-proxy.conf /etc/nginx/snippets/api-proxy.conf
COPY --from=build /app/out /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
