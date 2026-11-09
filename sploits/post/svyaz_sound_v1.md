# svyaz_sound_v1.py

The checker creates a private WAV sound in a restricted voice channel and a
public WAV sound with the same slot, then renames the public voice channel to
the restricted channel's name. The sound's immutable public ID is authorized,
but the prepared-audio alias can resolve to the private clip. The sploit joins
the guild, discovers the visible public custom clip, establishes an actual
WebRTC media connection with the bundled Linux/amd64 probe, plays the public
clip, fetches the resulting audio URL, and matches the 32 spoken-symbol
segments against the bundled voice atlas.

This is a network-side exploit: it never runs commands inside the victim
container. The probe needs UDP reachability from the attacker to the target.

The clip contains 32 spoken characters in a 9.6-second PCM WAV. Each character
occupies a 300-ms segment so it remains within the soundboard's 10-second
upload limit. The atlas is used only by the organizer checker and sploit; it is
not required by the service.
