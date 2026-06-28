FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache postgresql-client python3 py3-pip

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Python USAC importer (sodapy SDK) - optional, enable with USE_PYTHON_USAC_IMPORT=true
COPY server/scripts/requirements-usac-import.txt ./server/scripts/
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -r server/scripts/requirements-usac-import.txt && \
    ln -sf /opt/venv/bin/python /usr/local/bin/python3

COPY db ./db
COPY public ./public
COPY server ./server

ENV NODE_ENV=production
ENV PORT=3000
ENV PYTHON=python3
ENV PATH="/opt/venv/bin:${PATH}"

EXPOSE 3000

CMD ["node", "server/scripts/docker-entrypoint.js"]