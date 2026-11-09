package guild

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	c "svyaz.local/foundation/packages/contracts/generated/go"
	"svyaz.local/foundation/services/api/internal/identity"
)

func (g *transaction) voiceJoin(w http.ResponseWriter, resource Resource) (int, any, error) {
	if err := g.require("CONNECT_VOICE", resource); err != nil {
		return 0, nil, err
	}
	var in c.VoiceJoinInput
	if g.r.Method == "POST" {
		if err := identity.DecodeRequired(w, g.r, &in, "device_id", "call_id"); err != nil {
			return 0, nil, err
		}
	} else {
		in.DeviceID = g.r.URL.Query().Get("device_id")
		in.CallID = g.r.URL.Query().Get("call_id")
	}
	if !validID(in.DeviceID) || !validID(in.CallID) {
		return 0, nil, fail(400, "invalid_id")
	}
	channel, err := g.channel(resource.ID)
	if err != nil {
		return 0, nil, err
	}
	now := time.Now()
	end := now.Add(45 * time.Second)
	claims := c.VoiceGrant{SchemaVersion: 1, Audience: "voice-media", UserID: g.a.User.ID, SessionID: g.a.SessionID, DeviceID: in.DeviceID, CallID: in.CallID, ChannelID: resource.ID, GuildID: g.g.ID, ChannelName: channel.Name, DisplayName: g.a.User.DisplayName, CanSpeak: Decide(g.a.User.ID, "SPEAK", resource, g.s).Allowed, CanStream: Decide(g.a.User.ID, "STREAM_VIDEO", resource, g.s).Allowed, CanViewStream: Decide(g.a.User.ID, "VIEW_STREAM", resource, g.s).Allowed, Revision: g.g.Revision, IssuedAtUnix: now.Unix(), ExpiresAtUnix: end.Unix()}
	raw, _ := json.Marshal(claims)
	body := base64.RawURLEncoding.EncodeToString(raw)
	servers := []c.VoiceIceServer{}
	if stun := os.Getenv("VOICE_STUN_URL"); stun != "" {
		if !strings.HasPrefix(stun, "stun:") {
			return 0, nil, fail(503, "voice_configuration")
		}
		servers = append(servers, c.VoiceIceServer{Urls: []string{stun}})
	}
	if turn := os.Getenv("VOICE_TURN_URL"); turn != "" {
		secret := os.Getenv("VOICE_TURN_SECRET")
		if (!strings.HasPrefix(turn, "turn:") && !strings.HasPrefix(turn, "turns:")) || len(secret) < 24 {
			return 0, nil, fail(503, "voice_configuration")
		}
		username := strconv.FormatInt(now.Add(10*time.Minute).Unix(), 10) + ":" + g.a.User.ID
		mac := hmac.New(sha1.New, []byte(secret))
		_, _ = mac.Write([]byte(username))
		credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))
		servers = append(servers, c.VoiceIceServer{Urls: []string{turn}, Username: &username, Credential: &credential})
	}
	return 200, c.VoiceJoin{Grant: body + "." + base64.RawURLEncoding.EncodeToString(signature(g.server.VoiceSecret, body)), SignalingPath: "/api/v1/voice/ws", IceServers: servers, MaxParticipants: 6, MaxWidth: 1280, MaxHeight: 720, MaxVideoBitrate: 1200000}, nil
}
