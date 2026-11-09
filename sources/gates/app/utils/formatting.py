import re
from datetime import datetime, timezone


_FIELD_RE = re.compile(r"{{\s*(author|checkpoint|date|time)\s*}}")


def render_template(text: str, author: str, checkpoint: str) -> str:
    """Substitute the four documented bulletin fields without evaluating input."""
    now = datetime.now(timezone.utc)
    values = {
        "author": author,
        "checkpoint": checkpoint,
        "date": now.strftime("%d.%m.%Y"),
        "time": now.strftime("%H:%M"),
    }
    return _FIELD_RE.sub(lambda match: values[match.group(1)], text)
