from blacksheep import Request
from blacksheep.client import ClientSession
from blacksheep.contents import JSONContent
import idna
import secrets
from urllib.parse import urlsplit, urlunsplit

from ..config import settings
from .report_codec import open_route_payload
from .registry_auth import report_inbox_proof, report_inbox_url


def build_gateway_url(report_route_url: str) -> str:
    """Resolve a suffix as either an app path or a DNS suffix for the gateway."""
    prefix = urlsplit(settings.registry_url_prefix)
    if prefix.scheme not in ("http", "https") or not prefix.hostname:
        raise ValueError("invalid registry base URL")
    if prefix.username is not None or prefix.password is not None:
        raise ValueError("invalid registry base URL")

    if report_route_url.startswith("/"):
        route = urlsplit(report_route_url)
        return urlunsplit((
            prefix.scheme,
            prefix.netloc,
            route.path,
            route.query,
            route.fragment,
        ))

    suffix_host, separator, suffix_path = report_route_url.partition("/")
    port = prefix.port
    domain_suffix = suffix_host
    if suffix_host.count(":") == 1:
        host_suffix, _, raw_port = suffix_host.rpartition(":")
        if raw_port.isdecimal():
            domain_suffix = host_suffix
            port = int(raw_port)

    host = idna.encode(
        f"{prefix.hostname}{domain_suffix}",
        uts46=True,
        std3_rules=True,
    ).decode("ascii")

    authority = f"{host}:{port}" if port is not None else host
    route = urlsplit(f"/{suffix_path}" if separator else "/")
    return urlunsplit((
        prefix.scheme,
        authority,
        route.path,
        route.query,
        route.fragment,
    ))


async def request_corroboration(
    incident_id: str,
    summary: str,
    request_id: str | None = None,
    attachment: dict | None = None,
    report_route_url: str = "/registry/report-route",
) -> int:
    # The resolver path is relative by default. Its JSON descriptor contains
    # the absolute destination and method for the actual report submission.
    route_suffix = report_route_url or "/registry/report-route"
    request_id = request_id or secrets.token_hex(12)
    payload = {
        "summary": summary,
        "attachment": attachment,
        "request_id": request_id,
    }
    # Do not expose the HTTP client implementation in outbound reports.
    headers = [
        (b"user-agent", b"GateGuardian"),
        (b"x-case-id", incident_id.encode("ascii", "ignore")),
    ]

    try:
        gateway_url = build_gateway_url(route_suffix)
        async with ClientSession(
            follow_redirects=False,
            request_timeout=2,
        ) as client:
            descriptor_response = await client.send(
                Request("GET", gateway_url.encode("utf-8"), list(headers)),
            )
            if descriptor_response.status != 200:
                return 502

            descriptor = open_route_payload(await descriptor_response.json())

            method = descriptor.get("method")
            destination = descriptor.get("url")
            if (
                not isinstance(method, str)
                or not method
                or len(method) > 512
                or not isinstance(destination, str)
                or not destination
                or len(destination) > 4096
            ):
                return 502

            report_headers = list(headers)
            if (
                method.upper() == "POST"
                and destination == report_inbox_url(incident_id)
            ):
                report_headers.append((
                    b"x-registry-proof",
                    report_inbox_proof(incident_id).encode("ascii"),
                ))

            report_request = Request(
                method,
                destination.encode("utf-8"),
                report_headers,
            )
            report_request.with_content(JSONContent(payload))
            response = await client.send(report_request)
            return int(response.status)
    except Exception:
        # A malformed gateway response is a failed dispatch; never fall back
        # to treating the descriptor URL itself as a report destination.
        return 502
