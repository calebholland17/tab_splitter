FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
