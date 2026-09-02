# ==============================================================================
# BDU TỰ HỌC - PRODUCTION DOCKERFILE
# Runtime image: Node.js 22 + .NET 10 for the prebuilt WordFmt binary.
# ==============================================================================

# Keep both runtimes in explicit stages so the build context stays inside this
# repository. The WordFmt binary is already tracked at bin/wordfmt.
FROM node:22-bookworm-slim AS node-runtime

# .NET runtime base provides all native libraries required by WordFmt.
FROM mcr.microsoft.com/dotnet/runtime:10.0-bookworm-slim AS runner
WORKDIR /app

# Copy the Node.js runtime and npm from the official Node image.
COPY --from=node-runtime /usr/local /usr/local

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Install Node dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files, including the prebuilt bin/wordfmt binary.
COPY . .

# Fail during image build if either runtime is unavailable.
RUN node --version && dotnet --version

# Expose Web Port
EXPOSE 3000

# Start Application
CMD ["npm", "start"]
