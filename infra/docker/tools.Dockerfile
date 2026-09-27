# The worker and the deploy-time migration: the monorepo with tsx, no Next build.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/rds-global-bundle.pem
COPY package.json package-lock.json .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY db ./db
COPY tsconfig.json tsconfig.base.json ./
# tsx lives in devDependencies; the image runs TypeScript directly.
RUN npm ci --no-audit --no-fund --include=dev && chmod 644 /etc/ssl/rds-global-bundle.pem
USER node
CMD ["npx", "tsx", "scripts/worker.ts"]
