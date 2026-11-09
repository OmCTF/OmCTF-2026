# Repeated AES-GCM nonce

For each summary UUID, the script obtains public `batchId`, creates its own
Sealed summary with that batch and 32 known ASCII bytes, and reads both
capsules. If their nonces match, XOR of the two ciphertext prefixes and the
known plaintext recovers the victim's 32-byte flag. No key is read or guessed.

The script extracts all summary candidates from the current flat attack-data
array and rejects nonmatching nonces or non-flag plaintext.

Live test on 2026-11-02: 6 current flags in 8.2 seconds. Requires the
unpatched nonce derivation and readable capsule representation.
