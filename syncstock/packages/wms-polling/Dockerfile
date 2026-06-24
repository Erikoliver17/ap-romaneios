FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/middleware/package.json ./packages/middleware/
COPY packages/wms-polling/package.json ./packages/wms-polling/
RUN npm install --workspace=@syncstock/core --workspace=@syncstock/middleware --workspace=@syncstock/wms-polling

FROM base AS build
COPY packages/core/src ./packages/core/src
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/middleware/src ./packages/middleware/src
COPY packages/middleware/tsconfig.json ./packages/middleware/
COPY packages/wms-polling/src ./packages/wms-polling/src
COPY packages/wms-polling/tsconfig.json ./packages/wms-polling/
COPY tsconfig.base.json ./
RUN npm run build --workspace=@syncstock/core
RUN npm run build --workspace=@syncstock/middleware
RUN npm run build --workspace=@syncstock/wms-polling

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/middleware/dist ./packages/middleware/dist
COPY --from=build /app/packages/wms-polling/dist ./packages/wms-polling/dist
COPY packages/core/package.json ./packages/core/
COPY packages/middleware/package.json ./packages/middleware/
COPY packages/wms-polling/package.json ./packages/wms-polling/
COPY package.json ./
RUN npm install --workspace=@syncstock/core --workspace=@syncstock/middleware --workspace=@syncstock/wms-polling --omit=dev
CMD ["node", "packages/wms-polling/dist/index.js"]
