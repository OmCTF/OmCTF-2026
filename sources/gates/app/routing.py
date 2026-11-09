"""Small request-binding helpers for the BlackSheep route modules.

The service predates the BlackSheep experiment and has many endpoints with the
same session, authentication, and validation rules.  This module keeps those
rules in one place while registering every endpoint on BlackSheep's Router.
"""

from __future__ import annotations

import inspect
import json as std_json
import re
from dataclasses import asdict, dataclass, is_dataclass
from datetime import date, datetime
from enum import Enum
from typing import Any, get_args, get_origin, get_type_hints
from urllib.parse import parse_qs

from blacksheep import Request, Response, Router, json, no_content
from pydantic import BaseModel, ValidationError
from pydantic import TypeAdapter

from .exceptions import HTTPError

_MISSING = object()


@dataclass(frozen=True)
class Dependency:
    factory: Any


@dataclass(frozen=True)
class QueryValue:
    default: Any = _MISSING
    ge: int | float | None = None
    le: int | float | None = None
    max_length: int | None = None
    pattern: str | None = None


@dataclass(frozen=True)
class HeaderValue:
    default: Any = _MISSING
    name: str | None = None
    max_length: int | None = None


def Depends(factory):
    return Dependency(factory)


def Query(default=_MISSING, *, ge=None, le=None, max_length=None, pattern=None):
    if default is ...:
        default = _MISSING
    return QueryValue(default, ge, le, max_length, pattern)


def Header(default=_MISSING, *, name=None, max_length=None):
    if default is ...:
        default = _MISSING
    return HeaderValue(default, name, max_length)


def _unwrap_optional(annotation):
    origin = get_origin(annotation)
    if origin is not None and type(None) in get_args(annotation):
        return next((arg for arg in get_args(annotation) if arg is not type(None)), str), True
    return annotation, False


def _convert(value: str, annotation):
    annotation, optional = _unwrap_optional(annotation)
    if value == "" and optional:
        return None
    if annotation is Any or annotation is str or annotation is inspect.Parameter.empty:
        return value
    if annotation is bool:
        lowered = value.lower()
        if lowered in ("1", "true", "yes", "on"):
            return True
        if lowered in ("0", "false", "no", "off"):
            return False
        raise ValueError("expected a boolean")
    if annotation is int:
        return int(value)
    if annotation is float:
        return float(value)
    if isinstance(annotation, type) and issubclass(annotation, Enum):
        return annotation(value)
    return annotation(value)


def _json_value(value):
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if is_dataclass(value):
        return _json_value(asdict(value))
    if isinstance(value, dict):
        return {str(k): _json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_value(item) for item in value]
    return value


def _query_values(request: Request) -> dict[str, list[str]]:
    raw = request.scope.get("query_string", b"")
    return parse_qs(raw.decode("latin-1"), keep_blank_values=True)


async def _resolve_dependency(factory, request: Request, db, cache):
    if factory in cache:
        return cache[factory]
    if getattr(factory, "__module__", "").endswith(".database") and getattr(factory, "__name__", "") == "get_db":
        return db

    try:
        signature = inspect.signature(factory)
        hints = get_type_hints(factory)
    except (TypeError, ValueError):
        signature, hints = inspect.Signature(), {}

    kwargs = {}
    for parameter in signature.parameters.values():
        annotation = hints.get(parameter.name, parameter.annotation)
        default = parameter.default
        if isinstance(default, Dependency):
            kwargs[parameter.name] = await _resolve_dependency(default.factory, request, db, cache)
        elif isinstance(default, HeaderValue):
            kwargs[parameter.name] = _read_header(request, parameter.name, default, annotation)
        elif isinstance(default, QueryValue):
            kwargs[parameter.name] = _read_query(request, parameter.name, default, annotation)
        else:
            raise RuntimeError(f"Unsupported dependency parameter: {parameter.name}")

    result = factory(**kwargs)
    if inspect.isawaitable(result):
        result = await result
    cache[factory] = result
    return result


def _read_header(request, name, descriptor, annotation):
    name = descriptor.name or name
    header_name = name.replace("_", "-").encode("ascii")
    raw = request.get_first_header(header_name)
    if raw is None:
        if descriptor.default is _MISSING:
            raise HTTPError(422, f"Отсутствует заголовок {name.replace('_', '-')}.")
        return descriptor.default
    if descriptor.max_length is not None and len(raw) > descriptor.max_length:
        raise HTTPError(422, "Некорректный заголовок.")
    try:
        return _convert(raw.decode("latin-1"), annotation)
    except (TypeError, ValueError):
        raise HTTPError(422, f"Некорректный заголовок {name.replace('_', '-')}.") from None


def _read_query(request, name, descriptor, annotation):
    values = _query_values(request).get(name)
    if not values:
        if descriptor.default is _MISSING:
            raise HTTPError(422, f"Отсутствует параметр {name}.")
        return descriptor.default
    raw = values[-1]
    try:
        value = _convert(raw, annotation)
        if descriptor.max_length is not None and len(raw) > descriptor.max_length:
            raise ValueError("too long")
        if descriptor.ge is not None and value < descriptor.ge:
            raise ValueError("too small")
        if descriptor.le is not None and value > descriptor.le:
            raise ValueError("too large")
        if descriptor.pattern is not None and re.fullmatch(descriptor.pattern, raw) is None:
            raise ValueError("does not match")
        return value
    except (TypeError, ValueError):
        raise HTTPError(422, f"Некорректный параметр {name}.") from None


async def _bind_parameter(parameter, annotation, request, db, cache, body_cache):
    name = parameter.name
    default = parameter.default
    if isinstance(default, Dependency):
        return await _resolve_dependency(default.factory, request, db, cache)
    if isinstance(default, HeaderValue):
        return _read_header(request, name, default, annotation)
    if isinstance(default, QueryValue):
        return _read_query(request, name, default, annotation)

    route_values = request.route_values or {}
    if name in route_values:
        raw = route_values[name]
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        try:
            return _convert(str(raw), annotation)
        except (TypeError, ValueError):
            raise HTTPError(404, "Маршрут не найден.") from None

    if name == "request" and annotation is Request:
        return request

    annotation, _ = _unwrap_optional(annotation)
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        if "value" not in body_cache:
            try:
                body_cache["value"] = await request.json()
            except Exception:
                raise HTTPError(400, "Некорректное JSON-тело запроса.") from None
        try:
            return annotation.model_validate(body_cache["value"])
        except ValidationError as error:
            details = error.errors(include_input=False, include_url=False)
            raise HTTPError(422, std_json.dumps(details, ensure_ascii=False)) from None

    if default is not inspect.Parameter.empty:
        return default
    raise HTTPError(422, f"Не удалось определить источник параметра {name}.")


class RouteGroup:
    """A prefixed group of endpoints registered on a BlackSheep Router."""

    def __init__(self, *, prefix="", tags=None):
        self.prefix = prefix.rstrip("/")
        self.tags = tags or []
        self.backend = Router(prefix=self.prefix)

    def _register(self, method, path, *, status_code=200, response_model=None, **_metadata):
        def decorate(handler):
            try:
                signature = inspect.signature(handler)
                hints = get_type_hints(handler)
            except (TypeError, ValueError):
                signature, hints = inspect.Signature(), {}

            async def endpoint(request: Request):
                from .database import async_session_factory

                try:
                    async with async_session_factory() as db:
                        cache = {}
                        body_cache = {}
                        kwargs = {}
                        for parameter in signature.parameters.values():
                            if parameter.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
                                continue
                            annotation = hints.get(parameter.name, parameter.annotation)
                            kwargs[parameter.name] = await _bind_parameter(
                                parameter, annotation, request, db, cache, body_cache,
                            )
                        result = handler(**kwargs)
                        if inspect.isawaitable(result):
                            result = await result
                    if isinstance(result, Response):
                        return result
                    if response_model is not None:
                        result = TypeAdapter(response_model).validate_python(
                            result, from_attributes=True,
                        )
                    if status_code == 204:
                        return no_content()
                    return json(_json_value(result), status=status_code)
                except HTTPError as error:
                    response = json({"detail": error.detail}, status=error.status_code)
                    for name, value in error.headers.items():
                        response.add_header(name.encode("ascii"), value.encode("latin-1"))
                    return response
                except Exception:
                    import logging
                    logging.getLogger("gateguardian").exception("Unhandled request error")
                    return json({"detail": "Внутренняя ошибка сервиса."}, status=500)

            endpoint.__name__ = handler.__name__
            endpoint.__doc__ = handler.__doc__
            register = getattr(self.backend, f"add_{method.lower()}")
            register(path or "/", endpoint)
            return handler

        return decorate

    def get(self, path, **metadata):
        return self._register("GET", path, **metadata)

    def post(self, path, **metadata):
        return self._register("POST", path, **metadata)

    def put(self, path, **metadata):
        return self._register("PUT", path, **metadata)

    def patch(self, path, **metadata):
        return self._register("PATCH", path, **metadata)

    def delete(self, path, **metadata):
        return self._register("DELETE", path, **metadata)
