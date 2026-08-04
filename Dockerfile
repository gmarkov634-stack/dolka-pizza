FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl sqlite3 \
  && mkdir -p /app/certs \
  && curl --fail --silent --show-error --location \
       https://gu-st.ru/content/Other/doc/russiantrustedca.pem \
       --output /app/certs/russiantrustedca.pem \
  && test -s /app/certs/russiantrustedca.pem \
  && chmod 0644 /app/certs/russiantrustedca.pem \
  && apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json schema.sql server.js ./
COPY scripts ./scripts
COPY certs ./certs

RUN mkdir -p /app/data \
  && chmod +x /app/scripts/backup.sh \
  && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/app/certs/russiantrustedca.pem

EXPOSE 3000

CMD ["node", "server.js"]
