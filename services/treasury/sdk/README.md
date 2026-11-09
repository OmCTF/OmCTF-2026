# Казна. Комплект участника

Каждая команда может предоставить два исходника C++20 для ролей `raider` и `guard`. Размер каждого файла ограничен 16 КиБ. Интерфейсы стратегий определены в `include/kazna.hpp`. Начать можно с файлов из `examples/`. Полные правила описаны в [RULES.md](RULES.md).

Отправьте исходный файл через Skipper с командным токеном. Пример для задачи с именем `treasury` и активации налётчика в раунде 8:

```sh
curl --fail-with-body -sS \
  -H "X-Team-Token: $TEAM_TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @raider.cpp \
  'https://skipper.example/api/v1/arena/treasury/submissions?role=raider&from_round=8'
```

При отсутствии `from_round` заявка относится к ближайшему раунду. По умолчанию заявки можно подавать на пять раундов вперёд. Фактический горизонт задают настройки задачи. Правила и объявленные изменения доступны через `GET /api/v1/arena/treasury/rules`. Оборона из пакета используется для команд без своей заявки на роль `guard`.

Если организаторы предоставили адрес терминала Казны, можно отправить файл через `nc`:

```sh
{ printf 'AUTH %s\nATTACK %s\n' "$TEAM_TOKEN" "$(wc -c < raider.cpp | tr -d ' ')"; cat raider.cpp; } | nc -N jury.example 31337
```

Команда `HELP` показывает доступные операции. Для обороны используйте `DEFENSE`, для предварительной проверки `VALIDATE ATTACK` или `VALIDATE DEFENSE`.
