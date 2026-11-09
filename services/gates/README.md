# Ворота: развёртывание

Сервис рассчитан на Linux/amd64 и Docker Compose v2. Приложение поставляется
собранным бинарником `gateguardian`, исходники лежат в
[sources/gates](../../sources/gates). В стеке работают веб-приложение, воркер,
PostgreSQL и Redis.

```sh
sh start.sh
```

При первом запуске `start.sh` создаёт `.env` со случайными
`KPP_DATABASE_PASSWORD` и `KPP_MASTER_KEY`, затем выполняет
`docker compose up -d --build`. На каждом vulnbox секреты должны быть свои.

Веб слушает TCP `7777`. Порт меняется переменной `KPP_SERVICE_PORT` в `.env`.
PostgreSQL и Redis наружу не публикуются.
