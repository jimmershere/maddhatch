# Go TLS-ready frontend for Madd Hatchery
FROM golang:1.22-alpine AS build
WORKDIR /app
COPY . .
RUN apk add --no-cache git build-base && go mod tidy && go build -o server

FROM alpine:3.20
WORKDIR /app
RUN adduser -D -u 10001 appuser \
    && apk add --no-cache su-exec
COPY --from=build /app/server /app/server
COPY public /app/public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 8443
ENV HTTP_ADDR=:8443
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/app/server"]
