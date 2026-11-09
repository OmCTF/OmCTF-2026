FROM ubuntu:24.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates libicu74 libssl3t64 libstdc++6 libxml2 \
        libxslt1.1 media-types tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/kpp7 /run/kpp7 \
    && chown 65532:65532 /opt/kpp7 /run/kpp7

WORKDIR /opt/kpp7
COPY --chown=65532:65532 gateguardian ./gateguardian
RUN chmod 755 ./gateguardian
USER 65532:65532
EXPOSE 8000
CMD ["./gateguardian"]
