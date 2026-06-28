FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY db ./db
COPY public ./public
COPY server ./server

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/scripts/docker-entrypoint.js"]