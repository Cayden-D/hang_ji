FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS web-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web ./web
RUN npm run web:build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db
COPY --from=web-build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
