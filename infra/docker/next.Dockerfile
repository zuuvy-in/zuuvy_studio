# One image recipe for both Next apps: --build-arg APP=studio | renderer.
# Built from the repository root (the monorepo is the build context).
FROM node:22-bookworm-slim AS build
ARG APP
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --no-audit --no-fund
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @zsite/${APP}

FROM node:22-bookworm-slim
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# Amazon RDS CA bundle, so Postgres TLS is verified (DB_SSL=1).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/rds-global-bundle.pem
COPY --from=build /repo/apps/${APP}/.next/standalone ./
COPY --from=build /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
RUN chmod 644 /etc/ssl/rds-global-bundle.pem && echo "apps/${APP}/server.js" > /app/.entry
USER node
EXPOSE 3000
CMD ["sh", "-c", "exec node $(cat /app/.entry)"]
