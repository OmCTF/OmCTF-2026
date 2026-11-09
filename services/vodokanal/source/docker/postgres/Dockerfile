FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
ARG PG_MAJOR=18
ARG PG_VENDOR_VERSION=18.4-1.bookworm
ENV DEBIAN_FRONTEND=noninteractive \
    PG_MAJOR=${PG_MAJOR} \
    PGDATA=/var/lib/postgresql/data \
    PATH=/opt/pgpro/1c-${PG_MAJOR}/bin:${PATH} \
    PGHOST=/run/postgresql \
    LANG=ru_RU.UTF-8 \
    LC_ALL=ru_RU.UTF-8 \
    TZ=Europe/Moscow

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates locales tzdata gosu \
    && printf 'ru_RU.UTF-8 UTF-8\nen_US.UTF-8 UTF-8\n' > /etc/locale.gen \
    && locale-gen \
    && rm -rf /var/lib/apt/lists/*

COPY docker/postgres/vendor-release.asc /usr/share/keyrings/postgrespro-1c.asc
RUN set -eu; \
    echo '446654177cc3a9e6ea1434db307616883ef99b4f78e55a23fd9825ba4bc8de10  /usr/share/keyrings/postgrespro-1c.asc' | sha256sum -c -; \
    test "$PG_MAJOR" = 18; \
    test "$(dpkg --print-architecture)" = amd64; \
    printf 'deb [arch=amd64 signed-by=/usr/share/keyrings/postgrespro-1c.asc] https://repo.postgres.ru/1c/1c-18/debian bookworm main\n' \
      > /etc/apt/sources.list.d/postgrespro-1c.list; \
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; \
    chmod 0755 /usr/sbin/policy-rc.d; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      "postgrespro-1c-${PG_MAJOR}-server=${PG_VENDOR_VERSION}" \
      "postgrespro-1c-${PG_MAJOR}-client=${PG_VENDOR_VERSION}" \
      "postgrespro-1c-${PG_MAJOR}-libs=${PG_VENDOR_VERSION}" \
      "postgrespro-1c-${PG_MAJOR}-contrib=${PG_VENDOR_VERSION}"; \
    test -x "/opt/pgpro/1c-${PG_MAJOR}/bin/postgres"; \
    postgres --version; \
    id postgres; \
    rm /usr/sbin/policy-rc.d; \
    rm -rf /var/lib/apt/lists/*; \
    install -d -o postgres -g postgres -m 0700 "$PGDATA"; \
    install -d -o postgres -g postgres -m 0775 /run/postgresql

COPY --chmod=0755 docker/postgres/entrypoint.sh /usr/local/bin/postgres-entrypoint
EXPOSE 5432
STOPSIGNAL SIGINT
ENTRYPOINT ["/usr/local/bin/postgres-entrypoint"]
CMD ["postgres", "-c", "listen_addresses=*", "-c", "unix_socket_directories=/run/postgresql", "-c", "shared_buffers=256MB", "-c", "max_connections=100", "-c", "timezone=Europe/Moscow"]
