FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS webbuild
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --ignore-scripts
COPY packages/contracts/generated/ts ./packages/contracts/generated/ts
COPY apps/web ./apps/web
RUN npm run build

FROM golang:1.26.10-alpine@sha256:a2012b4a1d1f9f7e9f44e0d39b805a901e856b1dd80b4e6ee4338db547050308 AS gobuild
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY packages/contracts/generated/go ./packages/contracts/generated/go
COPY services/api ./services/api
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./services/api/cmd/api

FROM scratch AS api
COPY --from=gobuild /out/api /bin/api
COPY --chmod=755 bin/linux-amd64/svyaz-preflight /bin/preflight
COPY --chmod=755 bin/linux-amd64/svyaz-healthcheck /bin/healthcheck
COPY --chmod=755 bin/linux-amd64/svyaz-storage-start /bin/storage-start
COPY --chmod=755 bin/linux-amd64/svyaz-migrate /bin/migrate
COPY --from=webbuild /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
USER 65532:65532
EXPOSE 8080
CMD ["/bin/api"]

FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS rust
COPY --chmod=755 bin/linux-amd64/svyaz-rust /bin/svyaz-rust

EXPOSE 8081 8082 8083 20000/udp
CMD ["/bin/svyaz-rust", "serve"]

FROM chrislusf/seaweedfs:4.51@sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8 AS s3
COPY --chmod=755 bin/linux-amd64/svyaz-healthcheck /bin/healthcheck
COPY --chmod=755 bin/linux-amd64/svyaz-storage-start /bin/storage-start
ENTRYPOINT ["/bin/storage-start"]

FROM nginx:stable-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949 AS storage-gateway
COPY deploy/storage-gateway.conf /etc/nginx/nginx.conf
USER 101:101
ENTRYPOINT ["nginx", "-g", "daemon off;"]

FROM nginx:stable-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949 AS web
COPY --from=webbuild /src/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/templates/nginx.conf.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp
ENV NGINX_ENVSUBST_FILTER=WEB_
USER 101:101
EXPOSE 8080
CMD ["nginx", "-c", "/tmp/nginx.conf", "-g", "daemon off;"]
