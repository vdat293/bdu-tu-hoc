# ==============================================================================
# BDU TỰ HỌC - PRODUCTION DOCKERFILE
# Runtime image: Node.js 22 + .NET 10 for the prebuilt WordFmt binary.
# ==============================================================================

# Keep both runtimes in explicit stages so the build context stays inside this
# repository. The WordFmt binary is already tracked at bin/wordfmt.
FROM node:22-bookworm-slim AS node-runtime

# Build JSX in an isolated stage. The runtime image receives only the
# production dependency tree and the generated client artifact.
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY client ./client
COPY vite.config.js ./
# BUILD_ID (tuỳ chọn) ghi vào dist/client/build.json + meta `bdu-build` và
# được /api/version trả về để tab đang mở biết có bản mới. Để trống dùng timestamp.
ARG BUILD_ID=""
ENV BUILD_ID=$BUILD_ID
RUN npm run build:client

# .NET runtime base provides all native libraries required by WordFmt.
FROM mcr.microsoft.com/dotnet/runtime:10.0 AS runner
WORKDIR /app

# Copy the Node.js runtime and npm from the official Node image.
COPY --from=node-runtime /usr/local /usr/local

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install Node dependencies
COPY package*.json ./
RUN npm ci --omit=dev \
  && npx playwright install --with-deps chromium

# Copy application files, including the prebuilt bin/wordfmt binary.
COPY . .
COPY --from=frontend-build /app/dist/client ./dist/client

# Fail during image build if either runtime is unavailable. The runtime image
# intentionally has no SDK, so use --list-runtimes instead of --version.
RUN node --version && dotnet --list-runtimes

# Expose Web Port
EXPOSE 3000

# Start Application
CMD ["npm", "start"]
