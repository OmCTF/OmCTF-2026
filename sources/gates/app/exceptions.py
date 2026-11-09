class HTTPError(Exception):
    def __init__(self, status_code: int, detail: str, headers: dict[str, str] | None = None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.headers = headers or {}


class NotFound(HTTPError):
    def __init__(self, detail: str = "Не найдено."):
        super().__init__(404, detail)


class Forbidden(HTTPError):
    def __init__(self, detail: str = "Доступ запрещён."):
        super().__init__(403, detail)


class Unauthorized(HTTPError):
    def __init__(self, detail: str = "Предъявите действительный токен."):
        super().__init__(401, detail)


class Conflict(HTTPError):
    def __init__(self, detail: str = "Конфликт данных."):
        super().__init__(409, detail)


class BadRequest(HTTPError):
    def __init__(self, detail: str = "Некорректный запрос."):
        super().__init__(400, detail)


class RateLimited(HTTPError):
    def __init__(self, retry_after: int):
        super().__init__(429, "Слишком много запросов. Подождите.", {"Retry-After": str(retry_after)})
