# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:22-alpine AS deps

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# ============================================
# Stage 2: Build
# ============================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci --ignore-scripts && \
    npm cache clean --force

# Copy source code and Prisma schema
COPY prisma ./prisma/
COPY src ./src/
COPY nest-cli.json ./

# Generate Prisma Client
RUN npx prisma generate

# Build application
RUN npm run build

# ============================================
# Stage 3: Production
# ============================================
FROM node:22-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

# Set environment
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=error

# Copy production dependencies from deps stage
COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules

# Copy built application from builder stage
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/generated ./generated

# Copy Prisma schema (needed for migrations)
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma

# Copy package.json for version info
COPY --chown=nestjs:nodejs package*.json ./

# Switch to non-root user
USER nestjs

# Expose port (will be overridden by docker-compose)
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 4000) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "dist/main"]