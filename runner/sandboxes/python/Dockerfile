FROM python:3.13-alpine
RUN addgroup -S -g 1000 sandbox && adduser -S -u 1000 -G sandbox sandbox
ENV PYTHONDONTWRITEBYTECODE=1
USER 1000:1000
