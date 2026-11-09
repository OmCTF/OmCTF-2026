package guild

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"svyaz.local/foundation/services/api/internal/identity"
)

type soundClip struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Emoji       string `json:"emoji"`
	Slot        int16  `json:"slot"`
	DurationMS  int    `json:"duration_ms"`
	ContentType string `json:"content_type"`
	Builtin     bool   `json:"builtin,omitempty"`
}

var builtInSounds = []soundClip{
	{ID: "f0000000-0000-4000-8000-000000000001", Name: "Аплодисменты", Emoji: "👏", Slot: 0, DurationMS: 3007, ContentType: "audio/ogg", Builtin: true},
	{ID: "f0000000-0000-4000-8000-000000000002", Name: "Смех", Emoji: "😂", Slot: 1, DurationMS: 3607, ContentType: "audio/ogg", Builtin: true},
	{ID: "f0000000-0000-4000-8000-000000000003", Name: "Поздравляем", Emoji: "🎉", Slot: 2, DurationMS: 1296, ContentType: "audio/ogg", Builtin: true},
	{ID: "f0000000-0000-4000-8000-000000000004", Name: "Game over", Emoji: "💀", Slot: 3, DurationMS: 1378, ContentType: "audio/ogg", Builtin: true},
	{ID: "f0000000-0000-4000-8000-000000000005", Name: "Поехали", Emoji: "🚀", Slot: 4, DurationMS: 654, ContentType: "audio/ogg", Builtin: true},
	{ID: "f0000000-0000-4000-8000-000000000006", Name: "Колокольчики", Emoji: "🔔", Slot: 5, DurationMS: 2005, ContentType: "audio/ogg", Builtin: true},
	{ID: "f0000000-0000-4000-8000-000000000007", Name: "Неудача", Emoji: "❌", Slot: 6, DurationMS: 1063, ContentType: "audio/ogg", Builtin: true},
}

const maxSoundBytes = 2 << 20
const maxGuildSoundBytes = 64 << 20
const maxSoundBase64Bytes = ((maxSoundBytes + 2) / 3) * 4
const maxSoundJSONBytes = maxSoundBase64Bytes + 4096

type soundInput struct {
	Name        string `json:"name"`
	Emoji       string `json:"emoji"`
	AudioBase64 string `json:"audio_base64"`
}

type soundPlayable struct {
	ClipID      string `json:"clip_id"`
	GuildID     string `json:"guild_id"`
	ChannelID   string `json:"channel_id"`
	Name        string `json:"name"`
	Emoji       string `json:"emoji"`
	Slot        int16  `json:"slot"`
	DurationMS  int    `json:"duration_ms"`
	ContentType string `json:"content_type"`
	Builtin     bool   `json:"builtin,omitempty"`
}

func soundFormat(b []byte) (string, int, bool) {
	if len(b) > maxSoundBytes || len(b) < 128 {
		return "", 0, false
	}
	if len(b) >= 44 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WAVE" && string(b[12:16]) == "fmt " {
		format := binary.LittleEndian.Uint16(b[20:22])
		channels := binary.LittleEndian.Uint16(b[22:24])
		rate := binary.LittleEndian.Uint32(b[24:28])
		bits := binary.LittleEndian.Uint16(b[34:36])
		if format != 1 || channels < 1 || channels > 2 || rate < 8000 || rate > 48000 || bits != 16 {
			return "", 0, false
		}
		for p := 12; p+8 <= len(b); {
			n := int(binary.LittleEndian.Uint32(b[p+4 : p+8]))
			if n < 0 || p+8+n > len(b) {
				return "", 0, false
			}
			if string(b[p:p+4]) == "data" {
				ms := n * 1000 / int(rate) / int(channels) / 2
				return "audio/wav", ms, ms >= 100 && ms <= 10000
			}
			p += 8 + n + n%2
		}
	}
	if len(b) >= 64 && string(b[:4]) == "OggS" {
		if ms, ok := oggDuration(b); ok {
			return "audio/ogg", ms, true
		}
	}
	return "", 0, false
}

func oggPageCRC(page []byte) uint32 {
	var crc uint32
	for i, v := range page {
		if i >= 22 && i < 26 {
			v = 0
		}
		crc ^= uint32(v) << 24
		for bit := 0; bit < 8; bit++ {
			if crc&0x80000000 != 0 {
				crc = crc<<1 ^ 0x04c11db7
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

func oggDuration(b []byte) (int, bool) {
	var serial, sequence uint32
	var finalGranule uint64
	var rate uint32
	var preSkip uint16
	var codec string
	packet := make([]byte, 0, 256)
	packetNumber := 0
	pageNumber := 0
	eos := false
	continued := false
	for pos := 0; pos < len(b); pageNumber++ {
		if len(b)-pos < 27 || string(b[pos:pos+4]) != "OggS" || b[pos+4] != 0 || b[pos+5]&^byte(7) != 0 {
			return 0, false
		}
		flags := b[pos+5]
		if (flags&1 != 0) != continued || (pageNumber == 0) != (flags&2 != 0) || eos {
			return 0, false
		}
		segments := int(b[pos+26])
		if len(b)-pos < 27+segments {
			return 0, false
		}
		bodySize := 0
		for _, n := range b[pos+27 : pos+27+segments] {
			bodySize += int(n)
		}
		pageEnd := pos + 27 + segments + bodySize
		if pageEnd > len(b) || oggPageCRC(b[pos:pageEnd]) != binary.LittleEndian.Uint32(b[pos+22:pos+26]) {
			return 0, false
		}
		pageSerial := binary.LittleEndian.Uint32(b[pos+14 : pos+18])
		pageSequence := binary.LittleEndian.Uint32(b[pos+18 : pos+22])
		if pageNumber == 0 {
			serial, sequence = pageSerial, pageSequence
		} else if pageSerial != serial || pageSequence != sequence+1 || flags&2 != 0 {
			return 0, false
		} else {
			sequence = pageSequence
		}
		body := pos + 27 + segments
		for _, n := range b[pos+27 : body] {
			if packetNumber < 2 {
				packet = append(packet, b[body:body+int(n)]...)
			}
			body += int(n)
			continued = n == 255
			if !continued {
				if packetNumber == 0 {
					switch {
					case len(packet) >= 19 && string(packet[:8]) == "OpusHead" && packet[8] == 1 && packet[9] >= 1 && packet[9] <= 2:
						codec, rate = "opus", 48000
						preSkip = binary.LittleEndian.Uint16(packet[10:12])
					case len(packet) >= 30 && string(packet[:7]) == "\x01vorbis" && packet[11] >= 1 && packet[11] <= 2:
						codec = "vorbis"
						rate = binary.LittleEndian.Uint32(packet[12:16])
					default:
						return 0, false
					}
				} else if packetNumber == 1 && !((codec == "opus" && len(packet) >= 8 && string(packet[:8]) == "OpusTags") || (codec == "vorbis" && len(packet) >= 7 && string(packet[:7]) == "\x03vorbis")) {
					return 0, false
				}
				packetNumber++
				packet = packet[:0]
			}
		}
		if flags&4 != 0 {
			eos = true
			finalGranule = binary.LittleEndian.Uint64(b[pos+6 : pos+14])
		}
		pos = pageEnd
	}
	if !eos || continued || packetNumber < 3 || rate < 8000 || rate > 192000 || finalGranule <= uint64(preSkip) {
		return 0, false
	}
	samples := finalGranule - uint64(preSkip)
	if samples < uint64(rate)/10 || samples > uint64(rate)*10 {
		return 0, false
	}
	ms := int(samples * 1000 / uint64(rate))
	return ms, ms >= 100 && ms <= 10000
}

func soundName(s string, max int) bool {
	if !utf8.ValidString(s) || strings.TrimSpace(s) == "" || utf8.RuneCountInString(s) > max {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func (g *transaction) soundboard(w http.ResponseWriter, channel Resource, p []string) (int, any, error) {
	if channel.Kind != "VOICE" {
		return 0, nil, fail(400, "wrong_channel_type")
	}
	if err := g.require("VIEW_CHANNEL", channel); err != nil {
		return 0, nil, err
	}
	if len(p) == 0 && g.r.Method == "GET" {
		if !Decide(g.a.User.ID, "READ_HISTORY", channel, g.s).Allowed {
			return 200, map[string]any{"items": builtInSounds, "can_upload": false}, nil
		}
		rows, err := g.tx.Query(g.r.Context(), `SELECT id::text,name,emoji,slot,duration_ms,content_type FROM guild.sound_clips WHERE channel_id=$1 ORDER BY slot`, channel.ID)
		if err != nil {
			return 0, nil, err
		}
		defer rows.Close()
		items := append([]soundClip{}, builtInSounds...)
		for rows.Next() {
			var clip soundClip
			if err = rows.Scan(&clip.ID, &clip.Name, &clip.Emoji, &clip.Slot, &clip.DurationMS, &clip.ContentType); err != nil {
				return 0, nil, err
			}
			items = append(items, clip)
		}
		return 200, map[string]any{"items": items, "can_upload": Decide(g.a.User.ID, "MANAGE_CHANNEL", channel, g.s).Allowed}, rows.Err()
	}
	if len(p) == 0 && g.r.Method == "POST" {
		if err := g.require("MANAGE_CHANNEL", channel); err != nil {
			return 0, nil, err
		}
		var in soundInput
		d := json.NewDecoder(http.MaxBytesReader(w, g.r.Body, maxSoundJSONBytes))
		d.DisallowUnknownFields()
		if d.Decode(&in) != nil || !soundName(in.Name, 40) || !soundName(in.Emoji, 8) || len(in.AudioBase64) > maxSoundBase64Bytes {
			return 0, nil, fail(400, "invalid_sound")
		}
		var extra any
		if !errors.Is(d.Decode(&extra), io.EOF) {
			return 0, nil, fail(400, "invalid_sound")
		}
		audio, err := base64.StdEncoding.Strict().DecodeString(in.AudioBase64)
		if err != nil {
			return 0, nil, fail(400, "invalid_sound")
		}
		mime, duration, valid := soundFormat(audio)
		if !valid {
			return 0, nil, fail(415, "unsupported_sound")
		}
		var slot int16
		used := map[int16]bool{}
		rows, err := g.tx.Query(g.r.Context(), `SELECT slot FROM guild.sound_clips WHERE channel_id=$1`, channel.ID)
		if err != nil {
			return 0, nil, err
		}
		for rows.Next() {
			var n int16
			if err = rows.Scan(&n); err != nil {
				rows.Close()
				return 0, nil, err
			}
			used[n] = true
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return 0, nil, err
		}
		for slot = 0; slot < 8 && used[slot]; slot++ {
		}
		if slot >= 8 {
			return 0, nil, fail(409, "soundboard_full")
		}
		var storedBytes int64
		if err = g.tx.QueryRow(g.r.Context(), `SELECT coalesce(sum(octet_length(audio)),0)::bigint FROM guild.sound_clips WHERE guild_id=$1`, g.g.ID).Scan(&storedBytes); err != nil {
			return 0, nil, err
		}
		if storedBytes+int64(len(audio)) > maxGuildSoundBytes {
			return 0, nil, fail(409, "soundboard_storage_limit")
		}
		id := newID()
		if err = g.exec(`INSERT INTO guild.sound_clips(id,guild_id,channel_id,creator_id,slot,name,emoji,content_type,duration_ms,audio) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, g.g.ID, channel.ID, g.a.User.ID, slot, in.Name, in.Emoji, mime, duration, audio); err != nil {
			return 0, nil, err
		}
		if err = g.exec(`SELECT guild.prepare_sound_clip($1::uuid)`, id); err != nil {
			return 0, nil, err
		}
		if err = g.touch("soundboard.created", id); err != nil {
			return 0, nil, err
		}
		return 201, soundClip{ID: id, Name: in.Name, Emoji: in.Emoji, Slot: slot, DurationMS: duration, ContentType: mime}, nil
	}
	if len(p) == 2 && validID(p[0]) && p[1] == "prepare" && g.r.Method == "GET" {
		if err := g.require("CONNECT_VOICE", channel); err != nil {
			return 0, nil, err
		}
		if err := g.require("SPEAK", channel); err != nil {
			return 0, nil, err
		}
		for _, sound := range builtInSounds {
			if sound.ID == p[0] {
				return 200, soundPlayable{
					ClipID: sound.ID, GuildID: g.g.ID, ChannelID: channel.ID,
					Name: sound.Name, Emoji: sound.Emoji, Slot: sound.Slot,
					DurationMS: sound.DurationMS, ContentType: sound.ContentType, Builtin: true,
				}, nil
			}
		}
		if err := g.require("READ_HISTORY", channel); err != nil {
			return 0, nil, err
		}
		var v soundPlayable
		err := g.tx.QueryRow(g.r.Context(), `SELECT id::text,guild_id::text,channel_id::text,name,emoji,slot,duration_ms,content_type FROM guild.sound_clips WHERE id=$1 AND channel_id=$2`, p[0], channel.ID).Scan(&v.ClipID, &v.GuildID, &v.ChannelID, &v.Name, &v.Emoji, &v.Slot, &v.DurationMS, &v.ContentType)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil, fail(404, "sound_not_found")
		}
		return 200, v, err
	}
	if len(p) == 2 && validID(p[0]) && p[1] == "content" && g.r.Method == "GET" {
		if err := g.require("READ_HISTORY", channel); err != nil {
			return 0, nil, err
		}
		var audio []byte
		var mime string
		err := g.tx.QueryRow(g.r.Context(), `SELECT audio,content_type FROM guild.sound_clips WHERE id=$1 AND channel_id=$2`, p[0], channel.ID).Scan(&audio, &mime)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil, fail(404, "sound_not_found")
		}
		if err != nil {
			return 0, nil, err
		}
		return 200, identity.BinaryResponse{Headers: http.Header{
			"Content-Type":  {mime},
			"Cache-Control": {"private, no-store"},
		}, Body: audio}, nil
	}
	return 0, nil, fail(404, "not_found")
}
