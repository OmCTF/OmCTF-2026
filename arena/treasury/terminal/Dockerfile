FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY go.mod main.go main_test.go ./
RUN go test ./... && CGO_ENABLED=0 go build -trimpath -o /out/kazna-terminal .

FROM alpine:3.21
COPY --from=build /out/kazna-terminal /usr/local/bin/kazna-terminal
USER 10001
EXPOSE 31337
ENTRYPOINT ["/usr/local/bin/kazna-terminal"]
