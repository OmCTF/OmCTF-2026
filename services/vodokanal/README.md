# Вода: развёртывание

## Установщик 1С

Установщик платформы 1С в репозиторий не входит, его лицензия запрещает
распространение. Скачайте `setup-full-8.5.1.1522-x86_64.run` (сервер 1С:Предприятия
8.5.1.1522 для Linux x86_64) с [developer.1c.ru](https://developer.1c.ru) и
разложите его в формат, который ожидает Dockerfile:

```bash
cd source/vendor/onec
sha256sum -c setup-full-8.5.1.1522-x86_64.run.sha256
zstd -c setup-full-8.5.1.1522-x86_64.run | split -b 64m -d -a 3 - setup-full-8.5.1.1522-x86_64.run.zst.part
rm setup-full-8.5.1.1522-x86_64.run
```

Dockerfile соединяет части и перед установкой проверяет SHA-256
распакованного установщика.

## Первый запуск

Организатор до передачи доступа участникам кладёт в
`license-input/developer-credentials.txt` ровно две строки: логин
`developer.1c.ru` и пароль. 

```bash
chmod 700 license-input
chmod 600 license-input/developer-credentials.txt
sha256sum -c SHA256SUMS
docker compose up -d --build --wait --wait-timeout 1200
```

Если первая активация не удалась, положите исправленный файл и выполните:

```bash
docker compose restart onec
docker compose up -d --no-build --wait --wait-timeout 1200
```
