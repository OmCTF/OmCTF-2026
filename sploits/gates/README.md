# Сплойты «Ворот»

Каждый сплойт принимает IP цели первым аргументом и печатает найденные флаги
в stdout. Сервис ожидается на порту `7777`.

- `sploit_saml_forgery.py`: первый флагстор.
- `sploit_ssrf_into_celery.py`: второй флагстор. Нужны переменная
  `FORCAD_URL` с адресом ForcAD и пакет `cryptography`.

```sh
FORCAD_URL=http://forcad.example:18080 python3 sploit_ssrf_into_celery.py 10.60.1.42
```
