import base64
import binascii
import secrets

from pydantic import BaseModel, Field, field_validator


class EvidenceAttachment(BaseModel):
    filename: str = Field(
        min_length=1,
        max_length=128,
    )
    content_type: str = Field(
        default="application/octet-stream",
        max_length=128,
        pattern=r"^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$",
    )
    data_base64: str = Field(max_length=87384)

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        has_control = any(ord(ch) < 32 or ord(ch) == 127 for ch in value)
        if "/" in value or "\\" in value or has_control:
            raise ValueError("filename must be a plain file name")
        return value

    @field_validator("data_base64")
    @classmethod
    def validate_data_base64(cls, value: str) -> str:
        try:
            decoded = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("invalid base64 attachment") from exc
        if len(decoded) > 65536:
            raise ValueError("attachment exceeds 64 KiB")
        return value


class RegistryReportIn(BaseModel):
    summary: str = Field(max_length=2048)
    attachment: EvidenceAttachment | None = None
    request_id: str = Field(pattern=r"^[a-f0-9]{24}$")


class CorroborationRequest(BaseModel):
    summary: str = Field(default="Просьба сверить сведения по делу.", max_length=2048)
    attachment: EvidenceAttachment | None = None
    request_id: str = Field(
        default_factory=lambda: secrets.token_hex(12),
        pattern=r"^[a-f0-9]{24}$",
    )


class CorroborationResult(BaseModel):
    incident_id: str
    request_id: str
    status: int
    queued: bool


class ReportInboxOut(BaseModel):
    accepted: bool
    incident_id: str
    request_id: str
