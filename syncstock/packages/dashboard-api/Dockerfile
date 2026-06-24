FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/middleware/package.json ./packages/middleware/
COPY packages/dashboard-api/package.json ./packages/dashboard-api/
RUN npm install --workspace=@syncstock/core --workspace=@syncstock/middleware --workspace=@syncstock/dashboard-api

FROM base AS build
COPY packages/core/src ./packages/core/src
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/middleware/src ./packages/middleware/src
COPY packages/middleware/tsconfig.json ./packages/middleware/
COPY packages/dashboard-api/src ./packages/dashboard-api/src
COPY packages/dashboard-api/tsconfig.json ./packages/dashboard-api/
COPY tsconfig.base.json ./
RUN npm run build --workspace=@syncstock/core
RUN npm run build --workspace=@syncstock/middleware
RUN npm run build --workspace=@syncstock/dashboard-api

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/middleware/dist ./packages/middleware/dist
COPY --from=build /app/packages/dashboard-api/dist ./packages/dashboard-api/dist
COPY packages/core/package.json ./packages/core/
COPY packages/middleware/package.json ./packages/middleware/
COPY packages/dashboard-api/package.json ./packages/dashboard-api/
COPY package.json ./
RUN npm install --workspace=@syncstock/core --workspace=@syncstock/middleware --workspace=@syncstock/dashboard-api --omit=dev
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "packages/dashboard-api/dist/index.js"]
