FROM eclipse-temurin:21-jdk-alpine
RUN addgroup -S -g 1000 sandbox 2>/dev/null || true; adduser -S -u 1000 -G sandbox sandbox 2>/dev/null || true
USER 1000:1000
