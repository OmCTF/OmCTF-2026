# Vodokanal checker

`checker.py` is the ForcAD checker entry point. Install the versions from
`requirements.txt` in the ForcAD checker environment and add the task settings
from `forcad-task.yml` to the game configuration.

The files in `integration/` contain the ForcAD scheduler and public attack-data
patches, plus isolated tests for those patches. Apply the patches from the
ForcAD repository root. The public attack-data format is
`{"vodokanal":{"team-ip":["UUID", "UUID"]}}`.

Do not distribute checker files with the team service package: checker private
state is used to verify flags after placement.

`test_retry.py` checks bounded transport retries. Only registration and file
version replacement POSTs are retried, using the same idempotency key and body;
other writes remain single-attempt operations.
