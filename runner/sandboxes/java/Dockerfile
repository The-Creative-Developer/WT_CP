FROM eclipse-temurin:21-jdk-alpine
# The base image already sets LANG=en_US.UTF-8, so System.out prints Unicode correctly.
RUN addgroup -S -g 1000 sandbox && adduser -S -u 1000 -G sandbox sandbox
USER 1000:1000
