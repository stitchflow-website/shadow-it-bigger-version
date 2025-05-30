# 1. Install dependencies only when needed
FROM node:18-alpine AS deps
# Enable corepack for pnpm, yarn, etc.
RUN corepack enable
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
# Choose your package manager
RUN npm ci
# Or: RUN yarn install --frozen-lockfile
# Or: RUN pnpm install --frozen-lockfile

# 2. Rebuild the source code only when needed
FROM node:18-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1

# ARG for build-time substitution variables from Cloud Build
ARG _NEXT_PUBLIC_SUPABASE_URL
ARG _NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN echo "Build-time _NEXT_PUBLIC_SUPABASE_URL: ${_NEXT_PUBLIC_SUPABASE_URL}"
RUN echo "Build-time _NEXT_PUBLIC_SUPABASE_ANON_KEY: ${_NEXT_PUBLIC_SUPABASE_ANON_KEY}"

# Set them as environment variables for the build process
ENV NEXT_PUBLIC_SUPABASE_URL=${_NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${_NEXT_PUBLIC_SUPABASE_ANON_KEY}

# ENV NEXT_PUBLIC_SOME_VARIABLE=${NEXT_PUBLIC_SOME_VARIABLE}

# Add these lines for debugging:
RUN echo "Build-time NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}"
RUN echo "Build-time NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}"
# End of debug lines

RUN npm run build
# Or: yarn build
# Or: pnpm build

# 3. Production image, copy all the files and run next
FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

# server.js is created by standalone output
CMD ["node", "server.js"]