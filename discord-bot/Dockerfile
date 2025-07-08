# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /app



COPY package.json pnpm-lock.yaml* ./

RUN corepack enable pnpm
RUN pnpm install --prod --frozen-lockfile

COPY . .

# Stage 2: Create the final image
FROM node:20-alpine

WORKDIR /app

# Copy only necessary files from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/index.js .

# Expose port if your bot needs to listen for anything (e.g., webhooks), though typically not needed for Discord bots
# EXPOSE 3000

CMD ["node", "index.js"]
