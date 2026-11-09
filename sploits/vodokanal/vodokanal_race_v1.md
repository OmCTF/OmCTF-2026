# Live preview race

The script opens two distinct native 1C sessions for one ordinary account.
For each summary UUID it creates an owned, padded Live summary with the same
public batch. Concurrent public preview of the victim and full preview of the
owned summary can make the latter read the victim's content from the shared
batch register. Only the race is used to recover flags.

Each target gets at most 20 paired requests, with a bounded total runtime.
Transient connection errors are retried within that bound. The interleaving
is probabilistic and account read quotas still apply.

Live tests on 2026-11-02 recovered 6 current flags in isolated runs lasting
16-25 seconds. Concurrent load reduced the yield to 5 in a later run.
