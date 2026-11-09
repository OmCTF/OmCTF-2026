# Vodokanal S4DFarm sploits

Each `vodokanal_*_v1.py` attacks one vulnerability. S4DFarm passes the target
IP as the only command-line argument. The scripts fetch the current flat UUID
array from ForcAD on every run and print only recovered flags to stdout with
`flush=True`. Diagnostics go to stderr.

Install `requirements.txt` in the farm client's Python environment. Set
`FORCAD_URL` to the ForcAD base URL if it differs from
`http://forcad.example:18080`. `VDK_PORT` defaults to `8080`. Keep `common.py`
next to the four scripts. For example:

```bash
python3 client/start_sploit.py sploits/vodokanal/vodokanal_crypto_v1.py \
  --server-url http://127.0.0.1:5000
```

The summary preview distinguishes summary UUIDs from attachment UUIDs; no
type label or credential is required in public attack-data. The native preview
sploit has the largest runtime because it enumerates public intakes. Farm
timeout and service load can reduce the number of flags recovered per run.

See the matching `.md` file for the mechanism and live test result of each
sploit. Do not include this directory in a team service package.
