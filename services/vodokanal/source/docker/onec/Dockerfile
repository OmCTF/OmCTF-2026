FROM ubuntu:22.04 AS platform
ARG ONEC_VERSION=8.5.1.1522
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=ru_RU.UTF-8 \
    LC_ALL=ru_RU.UTF-8 \
    TZ=Europe/Moscow

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tzdata locales gosu fontconfig iproute2 \
      libfreetype6 libglib2.0-0 libgsf-1-114 libgssapi-krb5-2 \
      libodbc2 libfontconfig1 libharfbuzz0b libpango-1.0-0 \
      libpangocairo-1.0-0 libcairo2 libxml2 libxslt1.1 libicu70 \
      libssl3 libcurl4 libstdc++6 libx11-6 libxext6 libsm6 libice6 zstd \
    && locale-gen ru_RU.UTF-8 en_US.UTF-8 \
    && groupadd --gid 10001 grp1cv8 \
    && useradd --uid 10001 --gid grp1cv8 --create-home --shell /bin/bash usr1cv8 \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=bind,source=vendor/onec,target=/mnt/distr,ro \
    set -eu; \
    cd /tmp; \
    cat "/mnt/distr/setup-full-${ONEC_VERSION}-x86_64.run.zst.part"* | zstd -dc > "setup-full-${ONEC_VERSION}-x86_64.run"; \
    sha256sum --check --strict "/mnt/distr/setup-full-${ONEC_VERSION}-x86_64.run.sha256"; \
    chmod 0755 "setup-full-${ONEC_VERSION}-x86_64.run"; \
    ./"setup-full-${ONEC_VERSION}-x86_64.run" --mode unattended --enable-components server,server_admin,ws,ru; \
    rm "setup-full-${ONEC_VERSION}-x86_64.run"; \
    test -x "/opt/1cv8/x86_64/${ONEC_VERSION}/ragent"; \
    ln -s "/opt/1cv8/x86_64/${ONEC_VERSION}" /opt/onec; \
    for binary in ragent ras rac webinst; do \
      test -x "/opt/onec/$binary"; \
      ldd "/opt/onec/$binary" >/tmp/onec-ldd.txt; \
      if grep -q 'not found' /tmp/onec-ldd.txt; then cat /tmp/onec-ldd.txt; exit 1; fi; \
    done; \
    rm /tmp/onec-ldd.txt

ENV PATH="/opt/onec:${PATH}"

FROM platform AS runtime
COPY --chown=usr1cv8:grp1cv8 --chmod=0555 docker/native/*.so /opt/vodokanal-native/
COPY --chmod=0644 docker/native/ADDIN_TEMPLATE_LICENSE /opt/vodokanal-native/ADDIN_TEMPLATE_LICENSE
RUN set -eu; \
    for library in /opt/vodokanal-native/*AddIn.so; do \
      LD_LIBRARY_PATH=/opt/onec ldd -r "$library" > /tmp/vdk-native-ldd.txt; \
      if grep -Eq 'not found|undefined symbol' /tmp/vdk-native-ldd.txt; then \
        cat /tmp/vdk-native-ldd.txt; exit 1; \
      fi; \
    done; \
    rm /tmp/vdk-native-ldd.txt
COPY --chmod=0755 docker/onec/entrypoint.sh /usr/local/bin/onec-entrypoint
COPY --chmod=0755 docker/onec/create-infobase.sh /usr/local/bin/create-infobase
RUN mkdir -p /var/lib/1c/srvinfo /var/1C/licenses \
    && chown -R usr1cv8:grp1cv8 /var/lib/1c /var/1C /home/usr1cv8
WORKDIR /home/usr1cv8
EXPOSE 1540 1541 1545 1560-1591
ENTRYPOINT ["/usr/local/bin/onec-entrypoint"]
CMD ["ragent", "-port", "1540", "-regport", "1541", "-range", "1560:1591", "-d", "/var/lib/1c/srvinfo"]

FROM platform AS devtools
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcups2 libgtk-3-0 libxxf86vm1 libwebkit2gtk-4.0-37 \
      libglu1-mesa libgl1 xvfb xauth \
    && rm -rf /var/lib/apt/lists/*
ENV LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6
RUN test -x /opt/onec/1cv8 \
    && ldd /opt/onec/1cv8 > /tmp/designer-ldd.txt \
    && if grep -q 'not found' /tmp/designer-ldd.txt; then cat /tmp/designer-ldd.txt; exit 1; fi \
    && rm /tmp/designer-ldd.txt \
    && mkdir -p /artifacts /var/lib/1c/build /var/1C/licenses \
    && chown -R usr1cv8:grp1cv8 /artifacts /var/lib/1c /var/1C /home/usr1cv8
COPY --chmod=0755 docker/onec/tools-entrypoint.sh /usr/local/bin/tools-entrypoint
WORKDIR /home/usr1cv8
ENTRYPOINT ["/usr/local/bin/tools-entrypoint"]
CMD ["/help"]

FROM runtime AS gui
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcups2 libgtk-3-0 libxxf86vm1 libwebkit2gtk-4.0-37 \
      libglu1-mesa libgl1 xvfb xauth x11-utils x11vnc openbox \
      fonts-dejavu-core curl openssl python3-venv xdotool \
      imagemagick tesseract-ocr tesseract-ocr-rus \
    && python3 -m venv /opt/onec-gui-venv \
    && /opt/onec-gui-venv/bin/pip install --disable-pip-version-check --no-cache-dir websockify==0.13.0 \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=bind,source=vendor/gui,target=/mnt/gui,ro \
    set -eu; cd /mnt/gui; sha256sum --check --strict noVNC-1.7.0.tar.gz.sha256; \
    mkdir /opt/novnc; tar -xzf noVNC-1.7.0.tar.gz -C /opt/novnc --strip-components=1; \
    test -f /opt/novnc/vnc.html
COPY docker/onec/gui-conf.cfg /opt/1cv8/conf/conf.cfg
COPY docker/onec/gui-menu.xml /etc/xdg/openbox/menu.xml
COPY --chmod=0755 docker/onec/gui-entrypoint.sh /usr/local/bin/onec-gui-entrypoint
COPY --chmod=0755 docker/onec/gui-control.sh /usr/local/bin/onec-gui-control
COPY --chmod=0755 docker/onec/gui-session.sh /usr/local/bin/onec-gui-session
COPY --chmod=0755 docker/onec/gui-open.sh /usr/local/bin/onec-gui-open
RUN env LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6 ldd /opt/onec/1cv8 > /tmp/gui-ldd.txt \
    && if grep -q 'not found' /tmp/gui-ldd.txt; then cat /tmp/gui-ldd.txt; exit 1; fi \
    && rm /tmp/gui-ldd.txt
EXPOSE 6080
ENTRYPOINT ["/usr/local/bin/onec-gui-entrypoint"]
CMD ["ragent", "-port", "1540", "-regport", "1541", "-range", "1560:1591", "-d", "/var/lib/1c/srvinfo"]

FROM platform AS web
RUN apt-get update && apt-get install -y --no-install-recommends apache2 curl \
    && rm -rf /var/lib/apt/lists/* \
    && a2dismod mpm_event && a2enmod mpm_prefork headers unique_id lua \
    && install -d -o 0 -g 0 -m 0755 /etc/apache2/vodokanal \
    && mkdir -p /var/www/html/vodokanal \
    && printf 'ok\n' > /var/www/html/healthz \
    && rm /var/www/html/index.html
COPY docker/web/default.vrd /tmp/default.vrd
COPY docker/web/security.conf /etc/apache2/conf-available/vodokanal.conf
COPY --chown=0:0 --chmod=0644 docker/web/private-native401.lua /etc/apache2/vodokanal/private-native401.lua
COPY --chown=0:0 --chmod=0644 docker/web/private-native-session.lua docker/web/strict-json.lua /etc/apache2/vodokanal/
COPY docker/web/site.conf /etc/apache2/sites-available/vodokanal.conf
COPY --chown=0:0 --chmod=0755 docker/web/sanitize-apache-error.sh /usr/local/bin/sanitize-apache-error
RUN sed -i 's/\r$//' /usr/local/bin/sanitize-apache-error
COPY docker/web/*.html docker/web/*.js docker/web/*.css docker/web/*.png /var/www/html/
COPY docker/web/public-lab.conf docker/web/public-lab.vrd.template /opt/vodokanal-public/
COPY --chmod=0755 docker/web/configure-public-lab.sh /usr/local/bin/configure-public-lab
COPY docker/web/public-hydrology.conf docker/web/public-hydrology.vrd.template /opt/vodokanal-public-hydrology/
COPY --chmod=0755 docker/web/configure-public-hydrology.sh /usr/local/bin/configure-public-hydrology
COPY docker/web/identity-gateway.conf docker/web/identity-gateway.vrd.template /opt/vodokanal-identity-gateway/
COPY --chmod=0755 docker/web/configure-identity-gateway.sh /usr/local/bin/configure-identity-gateway
COPY docker/web/public-portal.conf docker/web/public-portal.vrd.template /opt/vodokanal-public-portal/
COPY --chmod=0755 docker/web/configure-public-portal.sh /usr/local/bin/configure-public-portal
COPY docker/web/public-dispatch.conf docker/web/public-dispatch.vrd.template /opt/vodokanal-public-dispatch/
COPY --chmod=0755 docker/web/configure-public-dispatch.sh /usr/local/bin/configure-public-dispatch
COPY --chmod=0755 docker/web/entrypoint.sh /usr/local/bin/web-entrypoint
RUN set -eu; \
    test -f /opt/onec/wsap24.so; \
    ldd /opt/onec/wsap24.so >/tmp/ws-ldd.txt; \
    if grep -q 'not found' /tmp/ws-ldd.txt; then cat /tmp/ws-ldd.txt; exit 1; fi; \
    /opt/onec/webinst -publish -apache24 -wsdir vodokanal \
      -dir /var/www/html/vodokanal \
      -connstr 'Srvr="onec:1541";Ref="vodokanal";' \
      -confpath /etc/apache2/apache2.conf -descriptor /tmp/default.vrd; \
    a2enconf vodokanal; \
    a2dissite 000-default; \
    a2ensite vodokanal; \
    apache2ctl configtest; \
    rm /tmp/default.vrd /tmp/ws-ldd.txt
ENV PUBLIC_LAB_ENABLE=0
ENV PUBLIC_HYDROLOGY_ENABLE=0
ENV IDENTITY_GATEWAY_ENABLE=0
ENV PUBLIC_PORTAL_ENABLE=0
ENV PUBLIC_DISPATCH_ENABLE=0
EXPOSE 80
STOPSIGNAL SIGWINCH
ENTRYPOINT ["/usr/local/bin/web-entrypoint"]
CMD ["-D", "FOREGROUND"]
