#!/usr/bin/env python3
import base64
import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import uuid
from urllib.parse import quote

import checklib
import requests

try:
    import fcntl
except ImportError:
    fcntl = None


OK = 101
CORRUPT = 102
MUMBLE = 103
DOWN = 104
CHECKER_ERROR = 110

FLAG_RE = re.compile(r"^[A-Z0-9]{31}=$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$")

PUBLIC_READS = (
    "/public-portal/hs/portal/v1/summary",
    "/public-portal/hs/portal/v1/services",
    "/public-portal/hs/portal/v1/content",
    "/public-portal/hs/portal/v1/faq",
    "/public/hs/lab/v1/reference",
    "/public/hs/lab/v1/protocols",
    "/public-hydrology/hs/hydrology/v1/reference",
    "/public-hydrology/hs/hydrology/v1/posts",
    "/public-dispatch/hs/dispatch/v1/intakes",
    "/public-dispatch/hs/dispatch/v1/addresses",
    "/public-dispatch/hs/dispatch/v1/outages",
)

CORE_READS = (
    "/v1/me",
    "/v1/system/readiness",
    "/v1/workspaces",
    "/v1/invitations",
    "/v1/my/requests",
    "/v1/account/contact",
    "/v1/notifications",
    "/v1/documents",
    "/v1/hydrology/reference",
    "/v1/lab/reference",
)

SCOPED_OWNER_READS = (
    "/v1/areas",
    "/v1/memberships",
    "/v1/dispatch/intakes",
)

SCOPED_STAFF_READS = (
    "/v1/dispatch/requests",
    "/v1/dispatch/incidents",
    "/v1/work/setup",
    "/v1/work/orders",
    "/v1/work/service-orders",
    "/v1/work/people",
    "/v1/hydrology/posts",
    "/v1/inventory/setup",
    "/v1/inventory/stock",
    "/v1/inventory/requests",
    "/v1/inventory/documents",
    "/v1/inventory/work-orders",
    "/v1/lab/technician/queue",
    "/v1/lab/technician/technicians",
    "/v1/lab/approver/queue",
)
SCOPED_STAFF_BY_SUITE = (
    ("/v1/hydrology/posts", "/v1/inventory/setup", "/v1/inventory/stock",
     "/v1/inventory/requests", "/v1/inventory/documents", "/v1/inventory/work-orders"),
    ("/v1/dispatch/requests", "/v1/dispatch/incidents"),
    ("/v1/lab/technician/queue", "/v1/lab/technician/technicians", "/v1/lab/approver/queue"),
    ("/v1/work/setup", "/v1/work/orders", "/v1/work/service-orders", "/v1/work/people"),
    (),
)
EXTRA_STAFF_BY_SUITE = (
    "/v1/work-materials/orders", "", "", "/v1/work/permits", "",
)
STAFF_ROLES_BY_SUITE = (
    ("Dispatcher", "Storekeeper"),
    ("Dispatcher",),
    ("LabTechnician", "LabApprover"),
    ("Dispatcher", "LabTechnician"),
    ("BillingSpecialist",),
)

SCOPED_WATER_READS = (
    "/v1/water/setup",
    "/v1/water/orders",
    "/v1/water/deliveries",
)

ROTATING_READS = (
    (
        "/v1/lab/my/orders",
        "/v1/lab/my/samples",
        "/v1/lab/public/protocols",
        "/v1/account/mailbox",
        "/v1/notifications/settings",
    ),
    (
        "/v1/my/personal-accounts",
        "/v1/account/personal-accounts",
        "/v1/account/sessions",
        "/v1/ownership-transfers",
        "/v1/notifications/deliveries",
    ),
    (
        "/v1/dispatch/public-intakes",
        "/v1/dispatch/intake-options",
        "/v1/lab/public/protocols",
        "/v1/notifications/settings",
    ),
    (
        "/v1/ownership-transfers",
        "/v1/notifications/deliveries",
        "/v1/account/sessions",
        "/v1/account/personal-accounts",
        "/v1/dispatch/intake-options",
    ),
)

CHECK_SUITES = (
    ("resources", "hydrology", "summaries"),
    ("files", "dispatch-outage"),
    ("lab-review", "lab-private"),
    ("documents", "work"),
    ("registry", "dispatch-network"),
)
CHECK_SCENARIOS = tuple("+".join(suite) for suite in CHECK_SUITES)
LEGACY_SUITE_IDS = (0, 1, 0, 3, 2, 2, 3, 3, 0, 4, 4, 1)
EXTRA_OWNER_READS = (
    "/v1/account-link-requests",
    "/v1/health",
    "/v1/dispatch/intake-options",
    "/v1/dispatch/public-intakes",
)
EXTRA_STAFF_READS = (
    "/v1/work-materials/orders",
    "/v1/work/permits",
)
ACCOUNT_READS = tuple(dict.fromkeys(
    CORE_READS + tuple(path for group in ROTATING_READS for path in group)
))


class CheckFailure(Exception):
    def __init__(self, code, public, private=""):
        super().__init__(public)
        self.code = code
        self.public = public
        self.private = private


class StickyCheckState:
    def __init__(self, host, port):
        directory = os.environ.get("VDK_CHECKER_STATE_DIR")
        if not directory:
            # Skipper runs the checker unprivileged from a root-owned bundle.
            bundle_key = hashlib.sha256(os.fsencode(os.path.realpath(__file__))).hexdigest()
            directory = os.path.join(tempfile.gettempdir(), "vodokanal-checker-" + bundle_key)
        key = hashlib.sha256((host + ":" + str(port)).encode("ascii")).hexdigest()
        self.directory = directory
        self.path = os.path.join(directory, key + ".check")
        self.lock_path = os.path.join(directory, key + ".lock")
        self.lock = None

    def __enter__(self):
        try:
            os.makedirs(self.directory, mode=0o700, exist_ok=True)
            descriptor = os.open(self.lock_path, os.O_CREAT | os.O_RDWR, 0o600)
            self.lock = os.fdopen(descriptor, "a+b")
            if fcntl is not None:
                fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX)
        except OSError as exc:
            if self.lock is not None:
                self.lock.close()
                self.lock = None
            raise CheckFailure(CHECKER_ERROR, "Недоступно состояние чекера", type(exc).__name__)
        return self

    def __exit__(self, error_type, error, traceback):
        if self.lock is not None:
            if fcntl is not None:
                fcntl.flock(self.lock.fileno(), fcntl.LOCK_UN)
            self.lock.close()
            self.lock = None

    def load(self):
        try:
            with open(self.path, "r", encoding="ascii") as stream:
                value = stream.read(32).strip()
        except FileNotFoundError:
            return None
        except (OSError, UnicodeError) as exc:
            raise CheckFailure(CHECKER_ERROR, "Недоступно состояние чекера", type(exc).__name__)
        if value.startswith("v2:"):
            scenario_id = value[3:]
            if scenario_id.isdigit() and len(scenario_id) == 1 and 0 <= int(scenario_id) < len(CHECK_SUITES):
                return int(scenario_id)
        elif value.isdigit() and len(value) <= 2 and 0 <= int(value) < len(LEGACY_SUITE_IDS):
            return LEGACY_SUITE_IDS[int(value)]
        raise CheckFailure(CHECKER_ERROR, "Повреждено состояние чекера")

    def save(self, scenario_id):
        if not 0 <= scenario_id < len(CHECK_SUITES):
            raise CheckFailure(CHECKER_ERROR, "Некорректный профиль чекера")
        temporary = None
        try:
            descriptor, temporary = tempfile.mkstemp(prefix=".check-", dir=self.directory)
            with os.fdopen(descriptor, "w", encoding="ascii") as stream:
                os.chmod(temporary, 0o600)
                stream.write("v2:" + str(scenario_id) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        except OSError as exc:
            raise CheckFailure(CHECKER_ERROR, "Не сохраняется состояние чекера", type(exc).__name__)
        finally:
            if temporary is not None and os.path.exists(temporary):
                os.unlink(temporary)

    def clear(self):
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise CheckFailure(CHECKER_ERROR, "Не очищается состояние чекера", type(exc).__name__)


def require(condition, public, code=MUMBLE, private=""):
    if not condition:
        raise CheckFailure(code, public, private)


def identifier(value, label, code=MUMBLE):
    require(isinstance(value, str) and UUID_RE.fullmatch(value) is not None,
            "Некорректный идентификатор " + label, code)
    require(uuid.UUID(value).version == 4, "Некорректная версия идентификатора " + label,
            code)
    return value


def compact(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def random_login():
    for _ in range(16):
        value = checklib.rnd_username(salt_length=10).lower()
        if (3 <= len(value) <= 64 and re.fullmatch(r"[a-z0-9._-]+", value)
                and not value.startswith("vodokanal_")):
            return value
    raise CheckFailure(CHECKER_ERROR, "Не удалось создать логин чекера")


def random_password():
    for _ in range(16):
        value = checklib.rnd_password(24)
        if (12 <= len(value) <= 128 and any(char.islower() for char in value)
                and any(char.isupper() for char in value)
                and any(char.isdigit() for char in value)):
            return value
    raise CheckFailure(CHECKER_ERROR, "Не удалось создать пароль чекера")


def random_hex(byte_count, upper=False):
    alphabet = "0123456789ABCDEF" if upper else "0123456789abcdef"
    return checklib.rnd_string(2 * byte_count, alphabet=alphabet)


def new_session(previous=None):
    session = checklib.get_initialized_session()
    if previous is not None:
        session.headers["User-Agent"] = previous.headers["User-Agent"]
    return session


def emit(code, public="", private=""):
    public = str(public)
    private = str(private)
    if len(public.encode("utf-8")) > 1000 or len(private.encode("utf-8")) > 1000:
        code, public, private = CHECKER_ERROR, "Ошибка вывода чекера", "output exceeds ForcAD limit"
    if public:
        sys.stdout.buffer.write(public.encode("utf-8"))
        sys.stdout.flush()
    if private:
        sys.stderr.buffer.write(private.encode("utf-8"))
        sys.stderr.flush()
    raise SystemExit(code)


class Service:
    def __init__(self, host, budget, port=None):
        require(HOST_RE.fullmatch(host) is not None, "Некорректный адрес команды", CHECKER_ERROR)
        port = str(port) if port is not None else os.environ.get("VDK_CHECKER_PORT", "8080")
        require(port.isdigit() and 1 <= int(port) <= 65535, "Некорректный порт чекера", CHECKER_ERROR)
        self.base = "http://{}:{}".format(host, port)
        self.private = self.base + "/vodokanal/hs/api"
        self.public_session = new_session()
        self.deadline = time.monotonic() + budget
        self.calls = 0

    def call(self, method, path, session=None, body=None, headers=None, auth=None,
             expected=200, missing=False):
        session = session or self.public_session
        request_headers = {"Accept": "application/json"}
        if method in ("POST", "PUT", "PATCH", "DELETE"):
            request_headers["X-Vodokanal-Request"] = "1"
            request_headers["Idempotency-Key"] = body.get("requestId", str(uuid.uuid4())) if isinstance(body, dict) else str(uuid.uuid4())
        if headers:
            request_headers.update(headers)
        retryable_write = method == "POST" and (
            path == "/identity/hs/identity/register"
            or ("/request-files/" in path and path.endswith("/versions")))
        attempts = 2 if method == "GET" or retryable_write else 1
        for attempt in range(attempts):
            remaining = self.deadline - time.monotonic()
            require(remaining > 0.5, "Время проверки сервиса истекло", DOWN)
            try:
                response = session.request(
                    method, self.base + path, json=body, headers=request_headers,
                    auth=auth, allow_redirects=False,
                    timeout=(min(2.0, remaining), min(6.0, remaining)),
                )
                if (response.status_code in (502, 503, 504)
                        and attempt + 1 < attempts
                        and self.deadline - time.monotonic() > 1.0):
                    continue
                break
            except requests.exceptions.ConnectionError as exc:
                if attempt + 1 < attempts and self.deadline - time.monotonic() > 1.0:
                    continue
                raise CheckFailure(DOWN, "Сервис недоступен",
                                   "{} {}: {}".format(method, path, type(exc).__name__))
            except requests.exceptions.RequestException as exc:
                if (isinstance(exc, requests.exceptions.Timeout)
                        and attempt + 1 < attempts
                        and self.deadline - time.monotonic() > 1.0):
                    continue
                raise CheckFailure(DOWN, "Сервис недоступен",
                                   "{} {}: {}".format(method, path, type(exc).__name__))
        self.calls += 1
        allowed = (expected,) if isinstance(expected, int) else expected
        if response.status_code not in allowed:
            if response.status_code in (502, 503, 504):
                code = DOWN
            elif missing and response.status_code in (400, 401, 403, 404, 410):
                code = CORRUPT
            else:
                code = MUMBLE
            raise CheckFailure(code, "Некорректный ответ сервиса", "{} {}: HTTP {}".format(method, path, response.status_code))
        if response.status_code < 300 and "/hs/" in path and not path.startswith("/identity/"):
            require(response.headers.get("X-API-Contract") == "1.0", "Несовместимая версия API",
                    MUMBLE, "{} {}: missing X-API-Contract 1.0".format(method, path))
        return response

    def data(self, method, path, session=None, body=None, headers=None, auth=None,
             expected=200, missing=False):
        response = self.call(method, path, session, body, headers, auth, expected, missing)
        try:
            result = response.json()
        except (ValueError, requests.exceptions.RequestException):
            raise CheckFailure(MUMBLE, "Некорректный JSON сервиса", "{} {}".format(method, path))
        require(isinstance(result, (dict, list)), "Некорректный ответ сервиса")
        return result

    def private_data(self, method, path, account, body=None, expected=200, missing=False):
        return self.data(method, "/vodokanal/hs/api" + path, account["session"], body,
                         expected=expected, missing=missing)

    def private_raw(self, path, account, expected=200, missing=False):
        return self.call("GET", "/vodokanal/hs/api" + path, account["session"],
                         expected=expected, missing=missing)

    def register(self):
        login = random_login()
        password = random_password()
        request_id = str(uuid.uuid4())
        body = {
            "login": login,
            "displayName": checklib.rnd_username(salt_length=6),
            "password": password,
            "mailboxKey": random_hex(32),
            "requestId": request_id,
        }
        session = new_session()
        result = self.data("POST", "/identity/hs/identity/register", session, body, expected=201)
        require(isinstance(result, dict), "Регистрация вернула некорректные данные")
        account_id = identifier(result.get("id"), "учётной записи")
        require(result.get("login") == login, "Регистрация вернула другую учётную запись")
        self.login(session, login, password)
        return {"session": session, "login": login, "password": password, "id": account_id}

    def login(self, session, login, password, missing=False):
        result = self.data("POST", "/vodokanal/hs/api/v1/auth/session", session, {},
                           headers={"IBSession": "start"}, auth=(login, password),
                           expected=200, missing=missing)
        require(isinstance(result, dict) and result.get("nativeName") == login,
                "Не удалось открыть сеанс", CORRUPT if missing else MUMBLE)
        require(bool(session.cookies.get("ibsession")), "Не получен сеанс 1С",
                CORRUPT if missing else MUMBLE)
        return result

    def old_account(self, login, password):
        session = new_session()
        self.login(session, login, password, missing=True)
        return {"session": session, "login": login, "password": password}

    def summary(self, owner, content, state):
        token = random_hex(8)
        title = token + "-private"
        batch = random_hex(32)
        result = self.private_data("POST", "/v1/private-summaries", owner, {
            "title": title, "content": content, "state": state, "batchId": batch,
        }, expected=201)
        require(isinstance(result, dict), "Создание сводки вернуло некорректные данные")
        return {"id": identifier(result.get("id"), "сводки"), "title": title, "batchId": batch}

    def grant_role(self, owner, staff, workspace_id, area_id, role):
        invitation = self.private_data("POST", "/v1/invitations", owner, {
            "workspaceId": workspace_id, "recipientAccountId": staff["id"],
            "role": role, "areaScope": "Area", "areaId": area_id,
        }, expected=201)
        require(isinstance(invitation, dict), "Приглашение вернуло некорректные данные")
        invitation_id = identifier(invitation.get("id"), "приглашения")
        revision = invitation.get("revision")
        require(isinstance(revision, int) and revision >= 1, "Некорректная редакция приглашения")
        self.private_data("POST", "/v1/invitations/{}/actions/accept".format(invitation_id),
                          staff, {"expectedRevision": revision}, expected=200)

    def internal_file(self, content, owner=None, expanded=False):
        owner = owner or self.register()
        requester = self.register()
        staff = self.register()
        token = random_hex(6)
        workspace = self.private_data("POST", "/v1/workspaces", owner,
                                      {"name": "Участок " + token}, expected=201)
        workspace_id = identifier(workspace.get("id"), "пространства")
        area = self.private_data("POST", "/v1/areas", owner,
                                 {"workspaceId": workspace_id, "name": "Север " + token}, expected=201)
        area_id = identifier(area.get("id"), "участка")
        address = "Probe Street " + token
        category = "Leak"
        intake = self.private_data("POST", "/v1/dispatch/intakes", owner, {
            "workspaceId": workspace_id, "defaultAreaId": area_id,
            "name": "Приёмная " + token, "addresses": [address],
            "categories": [category], "published": True, "accepting": True,
        }, expected=201)
        intake_id = identifier(intake.get("id"), "приёмной")
        self.grant_role(owner, staff, workspace_id, area_id, "Dispatcher")
        if expanded:
            self.grant_role(owner, requester, workspace_id, area_id, "WaterOperator")
        request = self.private_data("POST", "/v1/my/requests", requester, {
            "publicIntakeId": intake_id, "address": address, "category": category,
            "title": "Request " + token, "description": "Disposable test request",
            "contact": "Probe contact",
        }, expected=201)
        request_id = identifier(request.get("id"), "обращения")
        payload = base64.b64encode(content.encode("ascii")).decode("ascii")
        attachment = self.private_data("POST", "/v1/dispatch/requests/{}/files".format(request_id), staff, {
            "visibility": "Internal", "filename": "diagnostic-{}.txt".format(token),
            "mime": "text/plain", "contentBase64": payload,
        }, expected=201)
        file_id = identifier(attachment.get("id"), "вложения")
        return {"owner": owner, "requester": requester, "staff": staff,
                "requestId": request_id, "fileId": file_id,
                "workspaceId": workspace_id, "areaId": area_id, "intakeId": intake_id}

    def scope_context(self, owner, staff_roles=None):
        requester = self.register()
        staff = self.register()
        token = random_hex(6)
        workspace = self.private_data("POST", "/v1/workspaces", owner,
                                      {"name": "Участок " + token}, expected=201)
        workspace_id = identifier(workspace.get("id"), "пространства")
        area = self.private_data("POST", "/v1/areas", owner,
                                 {"workspaceId": workspace_id, "name": "Север " + token}, expected=201)
        area_id = identifier(area.get("id"), "участка")
        if staff_roles is None:
            staff_roles = ("Dispatcher", "Storekeeper", "LabTechnician", "LabApprover", "BillingSpecialist")
        for role in staff_roles:
            self.grant_role(owner, staff, workspace_id, area_id, role)
        self.grant_role(owner, requester, workspace_id, area_id, "WaterOperator")
        return {"owner": owner, "requester": requester, "staff": staff,
                "workspaceId": workspace_id, "areaId": area_id}

    def fresh_staff(self, context, role):
        staff = self.register()
        self.grant_role(context["owner"], staff, context["workspaceId"], context["areaId"], role)
        replacement = dict(context)
        replacement["staff"] = staff
        return replacement

    def resource_flows(self, context):
        staff = context["staff"]
        water_operator = context["requester"]
        scope = {"workspaceId": context["workspaceId"], "areaId": context["areaId"]}
        token = random_hex(5)
        unit = self.private_data("POST", "/v1/inventory/setup/Unit", staff,
                                 dict(scope, name="Unit " + token, precision=0), expected=201)
        unit_id = identifier(unit.get("id"), "единицы склада")
        material = self.private_data("POST", "/v1/inventory/setup/Material", staff,
                                     dict(scope, name="Material " + token, unitId=unit_id), expected=201)
        material_id = identifier(material.get("id"), "материала")
        warehouse = self.private_data("POST", "/v1/inventory/setup/Warehouse", staff,
                                      dict(scope, name="Warehouse " + token), expected=201)
        warehouse_id = identifier(warehouse.get("id"), "склада")
        cell = self.private_data("POST", "/v1/inventory/setup/Cell", staff,
                                 dict(scope, name="Cell " + token, warehouseId=warehouse_id), expected=201)
        cell_id = identifier(cell.get("id"), "ячейки")
        query = "?workspaceId={}&areaId={}".format(context["workspaceId"], context["areaId"])
        inventory = self.private_data("GET", "/v1/inventory/setup" + query, staff)
        inventory_text = compact(inventory)
        require(all(value in inventory_text for value in (unit_id, material_id, warehouse_id, cell_id)),
                "Не читаются созданные складские справочники")
        water_ids = {}
        for kind in ("sources", "points", "recipients"):
            entry = self.private_data("POST", "/v1/water/" + kind, water_operator,
                                      dict(scope, name=kind + " " + token), expected=201)
            entry_id = identifier(entry.get("id"), "настройки воды")
            water_ids[kind] = entry_id
            page = self.private_data("GET", "/v1/water/setup/" + kind + query, water_operator)
            require(entry_id in compact(page), "Не читается созданная настройка воды")
        water_time = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
        utc_time = lambda value: value.isoformat().replace("+00:00", "Z")
        water_scope = dict(scope, sourceId=water_ids["sources"], pointId=water_ids["points"],
                           occurredAt=utc_time(water_time), basis="Checker water stock")
        self.private_data("POST", "/v1/water/stock/seed", water_operator, water_scope, expected=201)
        self.private_data("POST", "/v1/water/receipts", water_operator,
                          dict(water_scope, quantity=3), expected=201)
        water_order = self.private_data("POST", "/v1/water/orders", water_operator, dict(scope,
            pointId=water_ids["points"], recipientId=water_ids["recipients"], quantity=5,
            scheduledAt=utc_time(water_time + datetime.timedelta(minutes=10))), expected=201)
        water_order_id = identifier(water_order.get("id"), "заказа воды")
        for action in ("confirm", "issue", "return"):
            current = self.private_data("GET", "/v1/water/orders/" + water_order_id, water_operator)
            body = {"expectedRevision": current.get("revision")}
            if action == "return":
                body.update(quantity=2, reason="Checker return")
            self.private_data("POST", "/v1/water/orders/{}/actions/{}".format(water_order_id, action),
                              water_operator, body)
        water_orders = self.private_data("GET", "/v1/water/orders" + query, water_operator)
        require(water_order_id in compact(water_orders), "Не отображается заказ воды")
        for path in ("/v1/water/balances", "/v1/water/movements"):
            self.private_data("GET", path + query + "&pointId=" + water_ids["points"], water_operator)
        occurred_at = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        receipt = self.private_data("POST", "/v1/inventory/documents", staff, dict(scope,
            operation="Receipt", materialId=material_id, warehouseId=warehouse_id,
            cellId=cell_id, quantity=5, basis="Checker receipt", occurredAt=occurred_at), expected=201)
        require(isinstance(receipt, dict) and receipt.get("state") == "Posted"
                and receipt.get("operation") == "Receipt", "Некорректный ответ прихода материалов")
        receipt_id = identifier(receipt.get("id"), "прихода материалов")
        document = self.private_data("GET", "/v1/inventory/documents/" + receipt_id + query, staff)
        require(isinstance(document, dict) and document.get("id") == receipt_id
                and document.get("state") == "Posted", "Не читается приход материалов")
        stock = self.private_data("GET", "/v1/inventory/stock" + query, staff)
        require(material_id in compact(stock), "Приход не отразился в остатках")

    def lab_order(self, context, lake_code=None):
        requester = context["requester"]
        reference = self.private_data("GET", "/v1/lab/reference", requester)
        require(isinstance(reference, dict) and isinstance(reference.get("lakes"), list)
                and bool(reference["lakes"]), "Недоступен справочник лаборатории")
        lake = (next((item for item in reference["lakes"] if item.get("code") == lake_code), None)
                if lake_code else reference["lakes"][0])
        require(isinstance(lake, dict) and isinstance(lake.get("code"), str),
                "Некорректный справочник лаборатории")
        collected_at = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=2))
        collected_at = collected_at.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        body = {
            "workspaceId": context["workspaceId"], "areaId": context["areaId"],
            "contact": "checker@example.test", "collectionMethod": "customer",
            "samples": [{"lakeCode": lake["code"], "waterType": "lake", "placeCode": "shore",
                         "source": "Canal", "location": "North bank", "collectedAt": collected_at,
                         "conditions": "Clear water", "panel": "basic"}],
        }
        order = self.private_data("POST", "/v1/lab/my/orders", requester, body, expected=201)
        require(isinstance(order, dict) and order.get("state") == "Draft",
                "Некорректный ответ заказа лаборатории")
        order_id = identifier(order.get("id"), "заказа лаборатории")
        detail = self.private_data("GET", "/v1/lab/my/orders/" + order_id, requester)
        require(isinstance(detail, dict) and detail.get("id") == order_id
                and detail.get("state") == "Draft", "Не читается заказ лаборатории")
        revision = order.get("revision")
        require(isinstance(revision, int) and revision >= 1, "Некорректная редакция заказа лаборатории")
        submitted_action = self.private_data("POST", "/v1/lab/my/orders/{}/actions/submit".format(order_id),
                                             requester, {"expectedRevision": revision, "reason": "Checker submission"})
        require(isinstance(submitted_action, dict) and submitted_action.get("state") == "Submitted"
                and submitted_action.get("revision") == revision + 1, "Не отправляется заказ лаборатории")
        submitted = self.private_data("GET", "/v1/lab/my/orders/" + order_id, requester)
        require(isinstance(submitted, dict) and submitted.get("id") == order_id
                and submitted.get("state") == "Submitted", "Не читается отправленный заказ лаборатории")
        samples = submitted.get("samples")
        require(isinstance(samples, list) and len(samples) == 1, "Не читается проба заказа")
        sample_id = identifier(samples[0].get("id"), "пробы лаборатории")
        for path in ("/v1/lab/my/samples/" + sample_id,
                     "/v1/lab/my/samples/{}/history".format(sample_id)):
            self.private_data("GET", path, requester)
        for path in ("/v1/lab/technician/orders/" + order_id,
                     "/v1/lab/technician/samples/" + sample_id,
                     "/v1/lab/technician/samples/{}/history".format(sample_id)):
            self.private_data("GET", path, context["staff"])
        return order_id, sample_id

    def lab_review_flow(self, context):
        _, sample_id = self.lab_order(context)
        staff = context["staff"]
        requester = context["requester"]
        path = "/v1/lab/technician/samples/" + sample_id
        current = self.private_data("GET", path, staff)
        for action in ("register", "assign", "start-analysis"):
            body = {"expectedRevision": current.get("revision"), "reason": "Checker " + action}
            if action == "assign":
                body["technicianAccountId"] = staff["id"]
            current = self.private_data("POST", path + "/actions/" + action, staff, body)
        values = [{"indicatorCode": "ph", "value": "7"},
                  {"indicatorCode": "turbidity", "value": "1"},
                  {"indicatorCode": "appearance", "value": "clear"}]
        current = self.private_data("POST", path + "/results", staff, {
            "expectedRevision": current.get("revision"), "comment": "Checker results", "values": values,
        }, expected=201)
        require(current.get("state") == "Review", "Лабораторный протокол не отправлен на проверку")
        approver = self.register()
        self.grant_role(context["owner"], approver, context["workspaceId"], context["areaId"], "LabApprover")
        approved = self.private_data("POST", "/v1/lab/approver/samples/{}/actions/approve".format(sample_id),
                                     approver, {"expectedRevision": current.get("revision"),
                                                "reason": "Checker approval"})
        require(approved.get("state") == "Approved", "Лабораторный протокол не утверждён")
        for role, account in (("my", requester), ("technician", staff), ("approver", approver),
                              ("public", requester)):
            base = "/v1/lab/{}/samples/{}/protocol".format(role, sample_id)
            protocol = self.private_data("GET", base, account)
            require(isinstance(protocol, dict) and protocol.get("sampleId") == sample_id,
                    "Не читается лабораторный протокол")
            csv = self.private_raw(base + ".csv", account)
            require(bool(csv.content), "Пустой CSV лабораторного протокола")
            if role in ("my", "public"):
                pdf = self.private_raw(base + ".pdf", account)
                require(pdf.content.startswith(b"%PDF"), "Некорректный PDF лабораторного протокола")
        self.private_data("GET", "/v1/lab/approver/samples/{}/history".format(sample_id), approver)

    def lab_private_flow(self, context):
        _, sample_id = self.lab_order(context, lake_code="potaennoe")
        private_text = "Заключение " + random_hex(8)
        path = "/v1/lab/my/samples/{}/private-conclusion".format(sample_id)
        self.private_data("POST", path, context["requester"],
                          {"expectedVersion": 0, "text": private_text}, expected=201)
        conclusion = self.private_data("GET", path, context["requester"])
        require(isinstance(conclusion, dict) and conclusion.get("text") == private_text,
                "Не читается частное заключение")

    def document_flow(self, context):
        order_id, _ = self.lab_order(context)
        owner = context["requester"]
        first = ("Lab document " + random_hex(8)).encode("ascii")
        created = self.private_data("POST", "/v1/documents", owner, {
            "objectType": "labOrder", "objectId": order_id, "field": "labOrderAttachment",
            "filename": "lab-note.txt", "mime": "text/plain",
            "contentBase64": base64.b64encode(first).decode("ascii"),
        }, expected=201)
        document_id = identifier(created.get("id"), "документа")
        path = "/v1/documents/" + document_id
        detail = self.private_data("GET", path, owner)
        require(isinstance(detail, dict) and detail.get("document", {}).get("id") == document_id,
                "Не читается документ")
        require(self.private_raw(path + "/download", owner).content == first,
                "Не скачивается документ")
        second = ("Revision " + random_hex(8)).encode("ascii")
        updated = self.private_data("POST", path + "/versions", owner, {
            "expectedRevision": created.get("revision"), "reason": "Checker version",
            "filename": "revision.txt", "mime": "text/plain",
            "contentBase64": base64.b64encode(second).decode("ascii"),
        }, expected=201)
        require(self.private_raw(path + "/download?version=1", owner).content == first,
                "Не читается старая редакция документа")
        require(self.private_raw(path + "/download", owner).content == second,
                "Не читается новая редакция документа")
        submitted = self.private_data("POST", path + "/actions/submit", owner,
                                      {"expectedRevision": updated.get("revision"),
                                       "reason": "Checker submit"})
        require(submitted.get("state") == "Submitted", "Не отправляется документ")
        archived = self.private_data("POST", path + "/actions/archive", owner,
                                      {"expectedRevision": updated.get("revision"),
                                       "reason": "Checker archive"})
        require(archived.get("state") == "Archived", "Не архивируется документ")
        listing = self.private_data("GET", "/v1/documents?objectId=" + order_id, owner)
        require(document_id in compact(listing), "Документ не отображается в списке")
        export = self.private_data("POST", "/v1/exports", owner, {
            "sourceKind": "documentRegistry", "parameters": {"kind": "incoming", "objectId": order_id},
            "format": "csv",
        }, expected=201)
        export_id = identifier(export.get("id"), "экспорта документов")
        require(bool(self.private_raw("/v1/exports/{}/download".format(export_id), owner).content),
                "Не скачивается экспорт документов")

    def work_orders(self, context):
        staff = context["staff"]
        self.private_data("GET", "/v1/areas/" + context["areaId"], context["owner"])
        self.private_data("GET", "/v1/workspaces/{}/authority".format(context["workspaceId"]), context["owner"])
        scope = {"workspaceId": context["workspaceId"], "areaId": context["areaId"]}
        token = random_hex(5)
        service_order = self.private_data("POST", "/v1/work/service-orders", staff, dict(scope,
            expectedRevision=0, title="Service " + token, objectDescription="North intake",
            requestedWork="Inspect water supply"), expected=201)
        require(isinstance(service_order, dict) and service_order.get("state") == "Registered",
                "Некорректный ответ заказа услуги")
        source_id = identifier(service_order.get("id"), "заказа услуги")
        service_detail = self.private_data("GET", "/v1/work/service-orders/" + source_id, staff)
        require(isinstance(service_detail, dict) and service_detail.get("id") == source_id,
                "Не читается заказ услуги")
        planned_from = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5)
        planned_to = planned_from + datetime.timedelta(minutes=30)
        planned_from = planned_from.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        planned_to = planned_to.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        order = self.private_data("POST", "/v1/work/orders", staff, dict(scope,
            expectedRevision=0, sourceKind="ServiceOrder", sourceId=source_id,
            requiredForIncident=False, title="Work " + token, task="Inspect intake",
            checklist=["Inspect valves"], priority="Normal",
            plannedFrom=planned_from, plannedTo=planned_to), expected=201)
        require(isinstance(order, dict) and order.get("state") == "Draft",
                "Некорректный ответ наряда")
        order_id = identifier(order.get("id"), "наряда")
        detail = self.private_data("GET", "/v1/work/orders/" + order_id, staff)
        require(isinstance(detail, dict) and detail.get("id") == order_id
                and detail.get("state") == "Draft" and detail.get("sourceKind") == "ServiceOrder",
                "Не читается наряд")
        for suffix in ("/history", "/permit-options", "/photos"):
            self.private_data("GET", "/v1/work/orders/" + order_id + suffix, staff)
        appendix_text = "Technical note " + random_hex(8)
        appendix = self.private_data("POST", "/v1/work/orders/{}/appendix-versions".format(order_id), staff, {
            "expectedRevision": order.get("revision"), "expectedVersion": 0,
            "privateText": appendix_text, "reason": "Checker appendix",
        }, expected=201)
        require(appendix.get("version") == 1, "Не сохраняется приложение наряда")
        for suffix in ("/appendix", "/appendix-versions/1"):
            record = self.private_data("GET", "/v1/work/orders/" + order_id + suffix, staff)
            require(record.get("privateText") == appendix_text, "Не читается приложение наряда")
        for suffix in ("/appendix/export", "/appendix-versions/1/export", "/print/order"):
            exported = self.private_raw("/v1/work/orders/" + order_id + suffix, staff)
            require(exported.content.startswith(b"%PDF"), "Не формируется PDF наряда")
        query = "?workspaceId={}&areaId={}".format(context["workspaceId"], context["areaId"])
        require(source_id in compact(self.private_data("GET", "/v1/work/service-orders" + query, staff)),
                "Не отображается заказ услуги")
        require(order_id in compact(self.private_data("GET", "/v1/work/orders" + query, staff)),
                "Не отображается наряд")

    def hydrology_flow(self, context):
        staff = context["staff"]
        scope = {"workspaceId": context["workspaceId"], "areaId": context["areaId"]}
        token = random_hex(5)
        created = self.private_data("POST", "/v1/hydrology/posts", staff, dict(scope,
            name="Post " + token, location="North bank", riverCode="irtysh",
            lowThreshold=10, highThreshold=100, staleAfterSeconds=3600,
            published=True, reason="Checker setup"), expected=201)
        require(isinstance(created, dict), "Не создаётся гидропост")
        post_id = identifier(created.get("postId"), "гидропоста")
        query = "?workspaceId={}&areaId={}".format(context["workspaceId"], context["areaId"])
        posts = self.private_data("GET", "/v1/hydrology/posts" + query, staff)
        require(post_id in compact(posts), "Не отображается гидропост")
        measured_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=2)
        measured_at = measured_at.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        measurement = self.private_data("POST", "/v1/hydrology/posts/{}/measurements".format(post_id),
            staff, dict(scope, measuredAt=measured_at, level=50, source="Checker",
                        published=True, reason="Checker measurement"), expected=201)
        require(isinstance(measurement, dict) and measurement.get("postId") == post_id,
                "Не сохраняется измерение")
        end_at = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        series_query = "?from={}&to={}".format(measured_at, end_at)
        series = self.private_data("GET", "/v1/hydrology/posts/{}/series".format(post_id) + series_query, staff)
        require(measured_at in compact(series), "Не читается измерение гидропоста")
        self.private_data("GET", "/v1/hydrology/posts/" + post_id + "/history?measuredAt=" + measured_at, staff)
        self.private_data("GET", "/v1/hydrology/posts/" + post_id + "/settings/history", staff)

    def registry_flow(self, context):
        staff = context["staff"]
        scope = {"workspaceId": context["workspaceId"], "areaId": context["areaId"]}
        query = "?workspaceId={}&areaId={}".format(context["workspaceId"], context["areaId"])
        token = random_hex(6)
        subscriber = self.private_data("POST", "/v1/subscribers", staff, dict(scope,
            name="Subscriber " + token, partyType="Person", phone="+70000000000",
            email="checker@example.test"), expected=201)
        subscriber_id = identifier(subscriber.get("id"), "абонента")
        property_record = self.private_data("POST", "/v1/properties", staff, dict(scope,
            name="Property " + token, ownerSubscriberId=subscriber_id,
            address="Test street " + token, propertyType="Residential"), expected=201)
        property_id = identifier(property_record.get("id"), "объекта недвижимости")
        point = self.private_data("POST", "/v1/service-points", staff, dict(scope,
            name="Point " + token, propertyId=property_id, serviceKind="WaterSupply"), expected=201)
        point_id = identifier(point.get("id"), "точки обслуживания")
        valid_from = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        contract = self.private_data("POST", "/v1/contracts", staff, dict(scope,
            name="Contract " + token, subscriberId=subscriber_id,
            propertyId=property_id, servicePointId=point_id, number="C-" + token,
            serviceKind="WaterSupply", validFrom=valid_from), expected=201)
        contract_id = identifier(contract.get("id"), "договора")
        account = self.private_data("POST", "/v1/personal-accounts", staff, dict(scope,
            name="Account " + token, contractId=contract_id, propertyId=property_id,
            servicePointId=point_id, number="A-" + token), expected=201)
        account_id = identifier(account.get("id"), "лицевого счёта")
        records = (("subscribers", subscriber_id), ("properties", property_id),
                   ("service-points", point_id), ("contracts", contract_id),
                   ("personal-accounts", account_id))
        for resource, record_id in records:
            detail = self.private_data("GET", "/v1/{}/{}".format(resource, record_id) + query, staff)
            require(isinstance(detail, dict) and detail.get("id") == record_id,
                    "Не читается запись реестра")
            listing = self.private_data("GET", "/v1/{}".format(resource) + query, staff)
            require(record_id in compact(listing), "Запись не отображается в реестре")
        for resource, record_id in records[:2]:
            self.private_data("GET", "/v1/registry-history/{}/{}".format(resource, record_id) + query, staff)
        exported_registry = self.private_raw("/v1/registry-exports/subscribers" + query, staff)
        require(bool(exported_registry.content), "Не выгружается реестр абонентов")
        now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
        utc = lambda value: value.isoformat().replace("+00:00", "Z")
        passport = self.private_data("POST", "/v1/meter-passports", staff, dict(scope,
            name="Meter " + token, meterType="ColdWater", manufacturer="Checker",
            model="Test", serialNumber=token.upper(), unit="m3", digits=8,
            coefficient=1, verificationUntil=utc(now + datetime.timedelta(days=365))), expected=201)
        passport_id = identifier(passport.get("id"), "паспорта прибора")
        passports = self.private_data("GET", "/v1/meter-passports" + query, staff)
        require(passport_id in compact(passports), "Не отображается паспорт прибора")
        installation = self.private_data("POST", "/v1/meter-installations", staff, {
            "passportId": passport_id, "personalAccountId": account_id,
            "servicePointId": point_id, "installedAt": utc(now - datetime.timedelta(days=2)),
            "admittedAt": utc(now - datetime.timedelta(days=1)), "initialValue": 0,
        }, expected=201)
        installation_id = identifier(installation.get("id"), "установки прибора")
        installation_detail = self.private_data("GET", "/v1/meter-installations/" + installation_id, staff)
        require(isinstance(installation_detail, dict) and installation_detail.get("id") == installation_id,
                "Не читается установка прибора")
        installations = self.private_data("GET", "/v1/meter-installations?personalAccountId=" + account_id, staff)
        require(installation_id in compact(installations), "Не отображается установка прибора")
        reading = self.private_data("POST", "/v1/meter-readings", staff, {
            "meterInstallationId": installation_id, "measuredAt": utc(now - datetime.timedelta(hours=1)),
            "value": 2,
        }, expected=201)
        reading_id = identifier(reading.get("id"), "показания прибора")
        require(reading.get("state") == "Accepted", "Показание прибора не принято")
        readings = self.private_data("GET", "/v1/meter-readings?meterInstallationId=" + installation_id, staff)
        require(reading_id in compact(readings), "Не отображается показание прибора")
        self.private_data("GET", "/v1/meter-installations/{}/accepted-series".format(installation_id), staff)
        for suffix in ("/correction-requests", "/review-decisions"):
            self.private_data("GET", "/v1/meter-installations/" + installation_id + suffix, staff)

    def dispatch_network_flow(self, context):
        staff = context["staff"]
        scope = {"workspaceId": context["workspaceId"], "areaId": context["areaId"]}
        query = "?workspaceId={}&areaId={}".format(context["workspaceId"], context["areaId"])
        token = random_hex(6)
        started = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)).replace(microsecond=0)
        forecast = started + datetime.timedelta(days=1)
        utc = lambda value: value.isoformat().replace("+00:00", "Z")
        incident = self.private_data("POST", "/v1/dispatch/incidents", staff, dict(scope,
            title="Incident " + token, type="Leak", severity="Moderate",
            startedAt=utc(started), forecastAt=utc(forecast), description="Checker network"), expected=201)
        incident_id = identifier(incident.get("id"), "инцидента")
        assets = []
        for number in (1, 2):
            body = dict(scope, name="Asset {} {}".format(number, token),
                        address="Network street " + token, type="Valve", state="Active",
                        description="Checker asset", x=number, y=number, reason="Checker create")
            created = self.private_data("POST", "/v1/dispatch/network-assets", staff, body, expected=201)
            assets.append((identifier(created.get("id"), "сетевого объекта"), created, body))
        first_id, first_record, first_body = assets[0]
        self.private_data("POST", "/v1/dispatch/network-assets/" + first_id, staff,
                          dict(first_body, expectedRevision=first_record.get("revision"),
                               description="Checker revised asset"))
        link_body = dict(scope, fromId=assets[0][0], toId=assets[1][0], state="Active",
                         reason="Checker link")
        link = self.private_data("POST", "/v1/dispatch/network-links", staff, link_body, expected=201)
        link_id = identifier(link.get("id"), "сетевой связи")
        self.private_data("POST", "/v1/dispatch/network-links/" + link_id, staff,
                          dict(link_body, expectedRevision=link.get("revision")))
        attached = self.private_data("POST", "/v1/dispatch/incidents/{}/network-asset".format(incident_id),
                                     staff, {"expectedRevision": incident.get("revision"),
                                             "networkAssetId": first_id, "reason": "Checker link"})
        require(attached.get("networkAssetId") == first_id, "Инцидент не связан с сетевым объектом")
        self.private_data("GET", "/v1/dispatch/incidents/" + incident_id, staff)
        for kind, record_id in (("network", first_id), ("networkLinks", link_id)):
            page = self.private_data("GET", "/v1/dispatch/pages/" + kind + query, staff)
            require(record_id in compact(page), "Не отображается объект диспетчерской")

    def dispatch_outage_flow(self, context):
        owner = context["owner"]
        staff = context["staff"]
        scope = {"workspaceId": context["workspaceId"], "areaId": context["areaId"]}
        query = "?workspaceId={}&areaId={}".format(context["workspaceId"], context["areaId"])
        token = random_hex(6)
        address = "Outage street " + token
        self.private_data("POST", "/v1/dispatch/intakes", owner, {
            "workspaceId": context["workspaceId"], "defaultAreaId": context["areaId"],
            "name": "Intake " + token, "addresses": [address], "categories": ["Leak"],
            "published": True, "accepting": True,
        }, expected=201)
        started = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)).replace(microsecond=0)
        utc = lambda value: value.isoformat().replace("+00:00", "Z")
        incident = self.private_data("POST", "/v1/dispatch/incidents", staff, dict(scope,
            title="Outage " + token, type="Supply", severity="Moderate",
            startedAt=utc(started), forecastAt=utc(started + datetime.timedelta(hours=5)),
            description="Checker outage"), expected=201)
        incident_id = identifier(incident.get("id"), "инцидента")
        body = dict(scope, sourceType="Incident", sourceId=incident_id, type="Planned",
                    reason="Checker outage", addresses=[address], waterPoints=[],
                    startedAt=utc(started), expectedRestoredAt=utc(started + datetime.timedelta(hours=4)),
                    state="Planned")
        outage = self.private_data("POST", "/v1/dispatch/outages", staff, body, expected=201)
        outage_id = identifier(outage.get("id"), "отключения")
        updated = self.private_data("POST", "/v1/dispatch/outages/" + outage_id, staff,
                                    dict(body, expectedRevision=outage.get("revision"),
                                         reason="Checker revised outage"))
        self.private_data("POST", "/v1/dispatch/outages/{}/publish".format(outage_id), staff,
                          {"expectedRevision": updated.get("revision"), "reason": "Checker publish"})
        page = self.private_data("GET", "/v1/dispatch/pages/outages" + query, staff)
        require(outage_id in compact(page), "Не отображается отключение")
        public = self.data("GET", "/public-dispatch/hs/dispatch/v1/outages?address=" + quote(address, safe=""))
        require(outage_id in compact(public), "Не публикуется отключение")


def rotation_window(paths, rotation, count):
    return tuple(paths[(rotation * count + offset) % len(paths)] for offset in range(count))


def check_plan(rotation, scenario_id=None):
    scoped_rotation = rotation
    if scenario_id is None:
        scenario_id = rotation % len(CHECK_SCENARIOS)
    return {
        "scenario": CHECK_SCENARIOS[scenario_id],
        "suite": CHECK_SUITES[scenario_id],
        "page": ("/", "/login", "/services")[rotation % 3],
        "public": rotation_window(PUBLIC_READS, rotation, 3),
        "account": rotation_window(ACCOUNT_READS, rotation, 5),
        "owner": EXTRA_OWNER_READS[rotation % len(EXTRA_OWNER_READS)],
        "scoped_owner": SCOPED_OWNER_READS[scoped_rotation % len(SCOPED_OWNER_READS)],
        "scoped_staff": SCOPED_STAFF_BY_SUITE[scenario_id],
        "scoped_water": SCOPED_WATER_READS[scoped_rotation % len(SCOPED_WATER_READS)],
        "extra_staff": EXTRA_STAFF_BY_SUITE[scenario_id],
    }


def check_summaries(service, owner):
    example = "Состояние объекта " + random_hex(8)
    draft = service.summary(owner, example, "Draft")
    exact = service.private_data("GET", "/v1/private-summaries/" + draft["id"], owner)
    require(isinstance(exact, dict) and exact.get("content") == example, "Нельзя прочитать свою сводку")
    preview = service.private_data("GET", "/v1/private-summaries/{}/preview?view=full".format(draft["id"]), owner)
    require(isinstance(preview, dict) and preview.get("content") == example, "Не работает предпросмотр сводки")
    public_preview = service.private_data("GET", "/v1/private-summaries/{}/preview?view=public".format(draft["id"]), owner)
    require(isinstance(public_preview, dict) and public_preview.get("title") == draft["title"],
            "Не работает публичный вид сводки")
    lookup = service.private_data("GET", "/v1/private-summary-lookup?title=" + draft["title"], owner)
    require(isinstance(lookup, dict) and lookup.get("content") == example, "Не работает поиск собственной сводки")
    capsule = service.private_data("GET", "/v1/private-summaries/{}/capsule".format(draft["id"]), owner)
    require(isinstance(capsule, dict), "Не работает капсула сводки")
    try:
        nonce = base64.b64decode(capsule["nonce"], validate=True)
        ciphertext = base64.b64decode(capsule["ciphertext"], validate=True)
    except (KeyError, TypeError, ValueError):
        raise CheckFailure(MUMBLE, "Некорректная капсула сводки")
    require(len(nonce) == 12 and len(ciphertext) == len(example.encode("utf-8")) + 16,
            "Некорректная капсула сводки")
    sealed = service.summary(owner, "Проверка архива " + random_hex(4), "Sealed")
    service.private_data("GET", "/v1/private-summaries/{}/capsule".format(sealed["id"]), owner)
    live_text = "Текущий пакет " + random_hex(6)
    live = service.summary(owner, live_text, "Live")
    live_preview = service.private_data("GET", "/v1/private-summaries/{}/preview?view=full".format(live["id"]), owner)
    require(isinstance(live_preview, dict) and live_preview.get("content") == live_text,
            "Не работает предпросмотр текущей сводки")
    settings = service.private_data("GET", "/v1/notifications/settings", owner)
    require(isinstance(settings, dict) and isinstance(settings.get("items"), list)
            and bool(settings["items"]), "Не читаются настройки уведомлений")
    first = settings["items"][0]
    changed = service.private_data("POST", "/v1/notifications/settings", owner, {
        "topic": first["topic"], "email": True, "sms": False,
        "expectedRevision": first["revision"],
    })
    require(changed.get("revision") == first["revision"] + 1,
            "Не сохраняются настройки уведомлений")
    new_password = random_password()
    password_result = service.private_data("POST", "/v1/account/password", owner,
                                           {"newPassword": new_password})
    require(password_result.get("reauthenticationRequired") is True,
            "Не меняется пароль учётной записи")
    owner["session"] = new_session(owner["session"])
    service.login(owner["session"], owner["login"], new_password)
    owner["password"] = new_password
    service.private_data("GET", "/v1/me", owner)
    revoked = service.private_data("POST", "/v1/account/sessions/actions/revoke-all", owner, {})
    require(revoked.get("reauthenticationRequired") is True, "Не отзываются сеансы")
    owner["session"] = new_session(owner["session"])
    service.login(owner["session"], owner["login"], new_password)
    service.private_data("GET", "/v1/me", owner)


def check_files(service, owner):
    test_content = "CHECK" + random_hex(12, upper=True)
    demo = service.internal_file(test_content, owner, expanded=True)
    service.private_data("GET", "/v1/my/requests/" + demo["requestId"], demo["requester"])
    for suffix in ("/history", "/timeline"):
        service.private_data("GET", "/v1/my/requests/" + demo["requestId"] + suffix, demo["requester"])
    for suffix in ("", "/history", "/timeline"):
        service.private_data("GET", "/v1/dispatch/requests/" + demo["requestId"] + suffix, demo["staff"])
    file_record = service.private_data("GET", "/v1/dispatch/request-files/" + demo["fileId"], demo["staff"])
    require(isinstance(file_record, dict) and isinstance(file_record.get("file"), dict)
            and file_record["file"].get("visibility") == "Internal",
            "Некорректный режим вложения")
    staff_content = service.private_raw("/v1/dispatch/request-files/{}/content".format(demo["fileId"]), demo["staff"])
    require(staff_content.content == test_content.encode("ascii"), "Не читается служебное вложение")
    service.private_data("GET", "/v1/dispatch/requests/{}/files".format(demo["requestId"]), demo["staff"])
    version_content = service.private_raw("/v1/dispatch/request-files/{}/versions/1/content".format(demo["fileId"]), demo["staff"])
    require(version_content.content == test_content.encode("ascii"), "Не читается версия вложения")
    public_content = "PUBLIC" + random_hex(6, upper=True)
    public_file = service.private_data("POST", "/v1/my/requests/{}/files".format(demo["requestId"]), demo["requester"], {
        "visibility": "Public", "filename": "note.txt", "mime": "text/plain",
        "contentBase64": base64.b64encode(public_content.encode("ascii")).decode("ascii"),
    }, expected=201)
    require(isinstance(public_file, dict), "Некорректный ответ загрузки вложения")
    public_file_id = identifier(public_file.get("id"), "общедоступного вложения")
    public_file_record = service.private_data("GET", "/v1/my/request-files/" + public_file_id, demo["requester"])
    require(isinstance(public_file_record, dict), "Не читается общедоступное вложение")
    requester_files = service.private_data("GET", "/v1/my/requests/{}/files".format(demo["requestId"]), demo["requester"])
    require(public_file_id in compact(requester_files), "Не отображается общедоступное вложение")
    public_file_preview = service.private_raw("/v1/my/request-files/{}/preview".format(public_file_id), demo["requester"])
    require(public_file_preview.content == public_content.encode("ascii"), "Не работает предпросмотр вложения")
    public_file_content = service.private_raw("/v1/my/request-files/{}/content".format(public_file_id), demo["requester"])
    require(public_file_content.content == public_content.encode("ascii"), "Не скачивается общедоступное вложение")
    public_version = service.private_raw("/v1/my/request-files/{}/versions/1/content".format(public_file_id), demo["requester"])
    require(public_version.content == public_content.encode("ascii"), "Не читается версия общедоступного вложения")
    internal_update = ("UPDATED" + random_hex(8, upper=True)).encode("ascii")
    service.private_data("POST", "/v1/dispatch/request-files/{}/versions".format(demo["fileId"]),
                         demo["staff"], {"expectedVersion": 1, "filename": "updated.txt",
                                         "mime": "text/plain", "reason": "Checker version",
                                         "contentBase64": base64.b64encode(internal_update).decode("ascii")},
                         expected=201)
    internal_v2 = service.private_raw("/v1/dispatch/request-files/{}/versions/2/content".format(demo["fileId"]),
                                      demo["staff"])
    require(internal_v2.content == internal_update, "Не читается новая версия служебного вложения")
    large_content = b"P" * 131072
    service.private_data("POST", "/v1/my/request-files/{}/versions".format(public_file_id),
                         demo["requester"], {"expectedVersion": 1, "filename": "large.txt",
                                              "mime": "text/plain", "reason": "Checker version",
                                              "contentBase64": base64.b64encode(large_content).decode("ascii")},
                         expected=201)
    public_v2 = service.private_raw("/v1/my/request-files/{}/versions/2/content".format(public_file_id),
                                    demo["requester"])
    require(public_v2.content == large_content, "Не читается большое вложение")
    request_path = "/v1/my/requests/" + demo["requestId"]
    staff_path = "/v1/dispatch/requests/" + demo["requestId"]
    card = service.private_data("GET", staff_path, demo["staff"])
    require(isinstance(card, dict) and isinstance(card.get("request"), dict),
            "Не читается карточка обращения")
    revision = card["request"].get("revision")
    require(isinstance(revision, int) and revision > 0, "Некорректная редакция обращения")
    def update_request(path, actor, fields):
        nonlocal revision
        body = dict(fields, expectedRevision=revision)
        updated = service.private_data("POST", path, actor, body)
        require(isinstance(updated, dict) and updated.get("revision") == revision + 1,
                "Некорректная редакция обращения")
        revision = updated["revision"]
    for path, actor, text_value in ((request_path + "/messages", demo["requester"], "Requester reply"),
                                    (staff_path + "/messages", demo["staff"], "Staff reply"),
                                    (staff_path + "/internal-notes", demo["staff"], "Internal note")):
        update_request(path, actor, {"text": text_value})
    due_at = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2))
    due_at = due_at.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    update_request(staff_path + "/triage", demo["staff"],
                   {"priority": "High", "dueAt": due_at, "reason": "Checker triage"})
    for action in ("accept", "ask-info"):
        update_request(staff_path + "/actions/" + action, demo["staff"],
                       {"reason": "Checker " + action})
    update_request(request_path + "/messages", demo["requester"], {"text": "Requested details"})
    update_request(staff_path + "/actions/resolve", demo["staff"], {"reason": "Checker resolve"})
    update_request(request_path + "/actions/reopen", demo["requester"], {"reason": "Checker reopen"})
    staff_card = service.private_data("GET", staff_path, demo["staff"])
    require("Internal note" in compact(staff_card), "Не сохраняется внутренняя заметка")
    return demo


def check_scope_reads(service, context, plan):
    scope = "?workspaceId={}&areaId={}".format(context["workspaceId"], context["areaId"])
    service.private_data("GET", plan["scoped_owner"] + scope, context["owner"])
    for path in plan["scoped_staff"]:
        service.private_data("GET", path + scope, context["staff"])
    service.private_data("GET", plan["scoped_water"] + scope, context["requester"])
    extra = plan["extra_staff"]
    if extra:
        service.private_data("GET", extra + (scope if extra.endswith("/orders") else ""), context["staff"])


def run_check(service, plan):
    page = service.call("GET", plan["page"])
    require("text/html" in page.headers.get("Content-Type", ""), "Недоступна страница портала")
    for path in plan["public"]:
        service.data("GET", path)
    owner = service.register()
    for path in plan["account"]:
        service.private_data("GET", path, owner)
    service.private_data("GET", plan["owner"], owner)
    suite = plan["suite"]
    staff_roles = STAFF_ROLES_BY_SUITE[CHECK_SUITES.index(suite)]
    if suite == CHECK_SUITES[0]:
        context = service.scope_context(owner, staff_roles)
        service.resource_flows(context)
        service.hydrology_flow(context)
        check_scope_reads(service, context, plan)
        check_summaries(service, owner)
        return
    if suite == CHECK_SUITES[1]:
        context = check_files(service, owner)
        outage_context = service.fresh_staff(context, "Dispatcher")
        service.dispatch_outage_flow(outage_context)
    else:
        context = service.scope_context(owner, staff_roles)
    if suite == CHECK_SUITES[2]:
        service.lab_review_flow(context)
        service.lab_private_flow(context)
    elif suite == CHECK_SUITES[3]:
        service.document_flow(context)
        service.work_orders(context)
    elif suite == CHECK_SUITES[4]:
        service.registry_flow(context)
        network_context = service.fresh_staff(context, "Dispatcher")
        service.dispatch_network_flow(network_context)
    check_scope_reads(service, context, plan)


def check(host, rotation=None):
    if rotation is not None:
        return run_check(Service(host, 30.0), check_plan(rotation))
    port = os.environ.get("VDK_CHECKER_PORT", "8080")
    with StickyCheckState(host, port) as state:
        current = int(time.time() // 60)
        selected_id = state.load()
        if selected_id is None:
            selected_id = current % len(CHECK_SCENARIOS)
        service = Service(host, 30.0)
        try:
            run_check(service, check_plan(current, selected_id))
        except CheckFailure as failure:
            if failure.code in (CORRUPT, MUMBLE, DOWN):
                state.save(selected_id)
            raise
        else:
            state.clear()


def put(host, supplied_id, flag, place):
    require(FLAG_RE.fullmatch(flag) is not None, "Некорректный флаг чекера", CHECKER_ERROR)
    require(place in ("1", "2"), "Некорректное место флага", CHECKER_ERROR)
    service = Service(host, 20.0)
    if place == "1":
        owner = service.register()
        summary = service.summary(owner, flag, "Draft")
        public = {"type": "summary", "id": summary["id"]}
        private = {"type": "summary", "id": summary["id"],
                   "login": owner["login"], "password": owner["password"]}
    else:
        file_info = service.internal_file(flag)
        staff = file_info["staff"]
        public = {"type": "attachment", "id": file_info["fileId"]}
        private = {"type": "attachment", "id": file_info["fileId"],
                   "request": file_info["requestId"],
                   "login": staff["login"], "password": staff["password"]}
    emit(OK, compact(public), compact(private))


def get(host, encoded, flag, place):
    require(FLAG_RE.fullmatch(flag) is not None, "Некорректный флаг чекера", CHECKER_ERROR)
    try:
        state = json.loads(encoded)
    except (TypeError, ValueError):
        raise CheckFailure(CHECKER_ERROR, "Некорректное состояние чекера")
    require(isinstance(state, dict) and state.get("type") in ("summary", "attachment"),
            "Некорректное состояние чекера", CHECKER_ERROR)
    expected_type = "summary" if place == "1" else "attachment" if place == "2" else ""
    require(state["type"] == expected_type, "Не совпало место флага", CHECKER_ERROR)
    file_id = identifier(state.get("id"), "флага", CHECKER_ERROR)
    login = state.get("login")
    password = state.get("password")
    require(isinstance(login, str) and isinstance(password, str) and login and password,
            "Некорректные данные чекера", CHECKER_ERROR)
    service = Service(host, 8.0)
    account = service.old_account(login, password)
    if expected_type == "summary":
        record = service.private_data("GET", "/v1/private-summaries/" + file_id,
                                      account, missing=True)
        require(isinstance(record, dict) and record.get("content") == flag,
                "Сводка не содержит флаг", CORRUPT)
        require(record.get("state") == "Draft", "Состояние сводки изменено", CORRUPT)
    else:
        request_id = identifier(state.get("request"), "обращения", CHECKER_ERROR)
        service.private_data("GET", "/v1/dispatch/requests/" + request_id,
                             account, missing=True)
        response = service.private_raw("/v1/dispatch/request-files/{}/content".format(file_id),
                                       account, missing=True)
        require(response.content == flag.encode("ascii"), "Вложение не содержит флаг", CORRUPT)


def main(argv):
    require(len(argv) >= 2, "Не задано действие чекера", CHECKER_ERROR)
    action = argv[1].lower()
    if action == "info":
        require(len(argv) == 2, "Некорректные аргументы чекера", CHECKER_ERROR)
        emit(OK, "vulns: 1:1")
    if action == "check":
        require(len(argv) == 3, "Некорректные аргументы чекера", CHECKER_ERROR)
        check(argv[2])
    elif action in ("put", "get"):
        require(len(argv) == 6, "Некорректные аргументы чекера", CHECKER_ERROR)
        if action == "put":
            put(argv[2], argv[3], argv[4], argv[5])
        else:
            get(argv[2], argv[3], argv[4], argv[5])
    else:
        raise CheckFailure(CHECKER_ERROR, "Неизвестное действие чекера")
    emit(OK)


if __name__ == "__main__":
    try:
        main(sys.argv)
    except CheckFailure as failure:
        emit(failure.code, failure.public, failure.private)
    except Exception as failure:
        emit(CHECKER_ERROR, "Внутренняя ошибка чекера", type(failure).__name__)
