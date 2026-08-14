FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm install --only=production

COPY --from=builder /app/dist ./dist

# Create data directory for settings
RUN mkdir -p /app/data

EXPOSE 3778

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3778/health || exit 1

CMD ["node", "dist/index.js"]
