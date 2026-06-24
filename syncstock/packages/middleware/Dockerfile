FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/middleware/package.json ./packages/middleware/
RUN npm install --workspace=@syncstock/core --workspace=@syncstock/middleware

FROM base AS build
COPY packages/core/src ./packages/core/src
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/middleware/src ./packages/middleware/src
COPY packages/middleware/tsconfig.json ./packages/middleware/
COPY tsconfig.base.json ./
RUN npm run build --workspace=@syncstock/core
RUN npm run build --workspace=@syncstock/middleware

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/middleware/dist ./packages/middleware/dist
COPY packages/core/package.json ./packages/core/
COPY packages/middleware/package.json ./packages/middleware/
COPY package.json ./
RUN npm install --workspace=@syncstock/core --workspace=@syncstock/middleware --omit=dev
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "packages/middleware/dist/index.js"]
