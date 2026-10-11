FROM node:24-alpine AS web
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM golang:1.27-alpine AS server
WORKDIR /src
COPY apps/server/go.mod apps/server/go.sum ./
RUN go mod download
COPY apps/server ./
COPY --from=web /src/apps/web/dist ./internal/web/static
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /ergon . && mkdir /data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /ergon /ergon
COPY --from=server --chown=nonroot:nonroot /data /data
ENV ERGON_DB=/data/ergon.db
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/ergon"]
