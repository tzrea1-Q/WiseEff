FROM node:22.21.1-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/ ./packages/
RUN npm ci

FROM node:22.21.1-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ARG VITE_WISEEFF_RUNTIME_MODE=api
ARG VITE_WISEEFF_API_BASE_URL
ENV VITE_WISEEFF_RUNTIME_MODE=$VITE_WISEEFF_RUNTIME_MODE
ENV VITE_WISEEFF_API_BASE_URL=$VITE_WISEEFF_API_BASE_URL
RUN apk add --no-cache curl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN NODE_OPTIONS='--max-old-space-size=2048' npx tsc -b && NODE_OPTIONS='--max-old-space-size=2048' npx vite build

CMD ["npx", "tsx", "server/index.ts"]
