# Svyaz organizer sploits

These files are for organizers, not for the team service distribution. Each
`svyaz_*_v1.py` is an independent S4DFarm sploit and accepts only the target IP
as `argv[1]`. Each fetches the current invite codes from ForcAD and prints
recovered flags as soon as they are available.
ForcAD publishes these invite codes under the task key `post`.

Install `requirements.txt`. Pillow is required for the media sploit's pixel OCR;
Tesseract is not required. Python `checklib` is used for account names and
passwords when present; the standard-library generator is a fallback. The
sound exploit also needs the bundled Linux/amd64 `voice-probe` binary and
working UDP connectivity to the target voice service.

Environment variables:

- `SVYAZ_FORCAD_URL`: ForcAD origin (default `http://forcad.example:18080`).
- `SVYAZ_SCHEME`, `SVYAZ_PORT`: service URL (default HTTPS for public IPs,
  HTTP for private IPs, and port 18080).
- `SVYAZ_HOST_TEMPLATE`: map `10.60.1.N` to a TLS hostname, for example
  `svyaz-{octet}.ad.example`.
- `SVYAZ_INVITES`: comma-separated invite codes for isolated tests only.
- `SVYAZ_PROBE_IP`: local reachable IPv4 for the WebRTC candidate, if route
  autodetection is insufficient.
- `SVYAZ_PROBE_CMD`: local test override for the voice probe executable.
- `SVYAZ_CACHE_DIR`: directory for the search sploit's five-minute local cache
  (default: the system temporary directory).

The source service package does not contain a `*_for_attackers.md` file. These
three scripts target the flagstores implemented by the current checker. They
use public attack data only, never the checker's private receipt.
