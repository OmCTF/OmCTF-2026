# svyaz_media_v1.py

The checker publishes a visual seed in the guild's visible general channel and
stores a PNG with the flag rendered as glyphs in its lower caption strip in a
private channel. Media deduplication fingerprints the upper image area. The
sploit joins via the public invite and uploads a matching upper image area to
its own guild. Initially its attachment serves its own original; after the
background alias cleanup it serves the shared original. The sploit waits for
that byte change, then performs pixel-based glyph OCR on the downloaded PNG.
No private room or object ID is needed, and the flag is not in PNG metadata.

**Status:** passed five consecutive fresh PUT/exploit/GET runs with the final
glyph atlas on the local Linux/amd64 hybrid stack. OCR recovered every exact
flag in 2.2-3.3 seconds.
