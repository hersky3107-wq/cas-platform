# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Install deps (including dev) using the lockfile for reproducible builds.
COPY package.json package-lock.json* ./
RUN npm install

# Compile TypeScript → dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only production deps in the final image.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Bring in the compiled output.
COPY --from=build /app/dist ./dist

# Kakao Cloud injects PORT; default to 3000. Bind 0.0.0.0 (set in code).
ENV PORT=3000
EXPOSE 3000

# APP_BASE_URL must be provided at deploy time, e.g.
#   docker run -e APP_BASE_URL=https://www.aimani.ai -p 3000:3000 jeju-mcp-server
CMD ["node", "dist/index.js"]
