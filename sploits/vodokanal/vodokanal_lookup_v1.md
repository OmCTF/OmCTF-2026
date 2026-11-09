# Lookup

The script registers an ordinary account, reads each known summary's public
preview, and creates its own Draft with the same leading index token and a
different suffix. The title lookup can
resolve to the foreign Draft and return its `content`. Only this lookup flaw
is used for flag recovery.

The flat ForcAD UUID array is fetched on every invocation. A public summary
preview identifies candidate summary IDs. Other records with the same index token can cause the
lookup to select another record, so the result is checked against the target
UUID before a flag is printed.

Live tests on 2026-11-02 recovered 3-4 current flags in about 6-8 seconds;
the yield fell as old records with the same index token accumulated. Requires
an unpatched lookup route.
