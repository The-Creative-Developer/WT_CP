# Alpine's g++ instead of the official gcc image: about 510 MB instead of 2.1 GB, with the same GCC 14.
FROM alpine:3.22

# Must match CPP_FLAGS in src/sandbox.ts: GCC silently ignores a precompiled header built with different flags.
ARG CPP_FLAGS="-std=gnu++20 -O2"

# [CONCEPT: Precompiled Headers] <bits/stdc++.h> pulls in the whole standard library and takes ~2 s to compile on
# half a CPU. Compiling it once here, into the image, cuts every run that includes it to a fraction of that.
RUN apk add --no-cache g++ \
 && addgroup -S -g 1000 sandbox && adduser -S -u 1000 -G sandbox sandbox \
 && header="$(find /usr/include/c++ -path '*/bits/stdc++.h' | head -n 1)" \
 && g++ $CPP_FLAGS -x c++-header "$header" -o "$header.gch"

USER 1000:1000
