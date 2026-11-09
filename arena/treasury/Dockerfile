FROM debian:trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends cmake g++ make libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY backend/ ./backend/
COPY tests/ ./tests/
COPY sdk/include/ ./sdk/include/
RUN cmake -S . -B /build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /build -j 2 \
    && ctest --test-dir /build --output-on-failure \
    && strip --strip-all /build/kazna-referee

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends g++ libssl3t64 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin kazna
COPY --from=build /build/kazna-referee /app/kazna-referee
COPY backend/strategy/runner.cpp sdk/include/kazna.hpp /app/strategy/
COPY defaults/ /app/defaults/
ENV ARENA_PORT=9090 KAZNA_STRATEGY_DIR=/app/strategy KAZNA_DEFAULT_GUARD=/app/defaults/guard.cpp
USER kazna
EXPOSE 9090
ENTRYPOINT ["/app/kazna-referee"]
