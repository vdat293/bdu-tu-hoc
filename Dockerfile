# ==============================================================================
# BDU TỰ HỌC - PRODUCTION DOCKERFILE
# Multi-stage build: .NET 10 LTS Core Engine + Node.js 20/22 Production Runtime
# ==============================================================================

# Stage 1: Build WordFmt .NET CLI
FROM mcr.microsoft.com/dotnet/sdk:10.0-preview AS dotnet-builder
WORKDIR /build

# Copy WordFmt project files from source
COPY ["../dinh dang word/src/", "./src/"]
RUN dotnet publish "./src/WordFmt.Cli/WordFmt.Cli.csproj" -c Release -o /app/bin/wordfmt

# Stage 2: Production Node.js Runtime
FROM node:22-alpine AS runner
WORKDIR /app

# Install .NET runtime dependencies if needed on Alpine / Debian
RUN apk add --no-cache bash icu-libs krb5-libs libgcc libintl libssl3 libstdc++ zlib dotnet10-runtime || true

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Install Node dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY . .
COPY --from=dotnet-builder /app/bin/wordfmt ./bin/wordfmt

# Expose Web Port
EXPOSE 3000

# Start Application
CMD ["npm", "start"]
