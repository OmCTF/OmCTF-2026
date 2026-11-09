import ticketlib
from xml.etree import ElementTree
from ..runtime_secrets import saml_credentials

LEVEL_NAMES = {
    ticketlib.LEVEL_REJECT: "отклонен",
    ticketlib.LEVEL_GUEST: "гость",
    ticketlib.LEVEL_RESIDENT: "резидент",
    ticketlib.LEVEL_COMMANDANT: "комендант",
}


def issue(subject: str, role: str = "guest") -> str | None:
    private_key_der, _ = saml_credentials()
    return ticketlib.issue_pass(subject, role, private_key_der)


def verify(xml: str) -> int:
    _, certificate_der = saml_credentials()
    return ticketlib.verify_pass(xml, certificate_der)


def is_commandant(xml: str) -> bool:
    _, certificate_der = saml_credentials()
    return ticketlib.pass_grants_flag(xml, certificate_der)


def subject(xml: str) -> str | None:
    """Return the NameID from a document that has already passed verification."""
    try:
        root = ElementTree.fromstring(xml)
    except (ElementTree.ParseError, ValueError):
        return None
    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1] == "Subject":
            for child in node:
                if child.tag.rsplit("}", 1)[-1] == "NameID":
                    return child.text
    return None


def level_name(level: int) -> str:
    return LEVEL_NAMES.get(level, f"неизвестно({level})")


def version() -> str:
    return ticketlib.version()
