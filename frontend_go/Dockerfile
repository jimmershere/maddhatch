# Go TLS-ready frontend for Madd Hatchery
FROM golang:1.22-alpine AS build
WORKDIR /app
COPY . .
RUN apk add --no-cache git build-base && go mod tidy && go build -o server

FROM alpine:3.20
WORKDIR /app
RUN adduser -D -u 10001 appuser
COPY --from=build /app/server /app/server
COPY public /app/public
EXPOSE 8443
USER appuser
ENV HTTP_ADDR=:8443
CMD ["/app/server"]
