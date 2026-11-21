FROM node:24-alpine AS web
WORKDIR /src
RUN corepack enable
# one manifest per workspace package in pnpm-workspace.yaml, so the install layer stays cached
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM golang:1.27-alpine AS server
WORKDIR /src
COPY apps/server/go.mod apps/server/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/server ./
COPY --from=web /src/apps/web/dist ./internal/web/static
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /ergon . && mkdir /data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /ergon /ergon
COPY --from=server --chown=nonroot:nonroot /data /data
ENV ERGON_DB=/data/ergon.db
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/ergon"]
