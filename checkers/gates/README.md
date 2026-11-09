# Чекер «Ворот» для ForcAD

Чекер написан на `checklib`. Зависимости перечислены в `requirements.txt`.
Он запускается с аргументами Hackerdom/ForcAD: `check <host>`,
`put <host> <flag_id> <flag> <vuln>`, `get <host> <flag_id> <flag> <vuln>`.

У сервиса два флагстора (`vuln` 1 и 2). Порт по умолчанию `7777`,
переменная `KPP_SERVICE_PORT` его переопределяет.
