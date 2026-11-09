// kazna-terminal adapts the original line protocol to Skipper's Arena API.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"
)

const sourceLimit = 16 << 10
const responseLimit = 2 << 20

var role = map[string]string{"ATTACK": "raider", "DEFENSE": "guard"}
var taskName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

type gateway struct {
	api    string
	client *http.Client
}

type submission struct {
	Role      string `json:"role"`
	FromRound int    `json:"from_round"`
	SHA256    string `json:"sha256"`
}

type submissions struct {
	TeamID      int64        `json:"team_id"`
	Submissions []submission `json:"submissions"`
}

func (g gateway) request(ctx context.Context, path, token string, source []byte, out any) error {
	method := http.MethodGet
	var body io.Reader
	if source != nil {
		method, body = http.MethodPost, bytes.NewReader(source)
	}
	req, err := http.NewRequestWithContext(ctx, method, g.api+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("X-Team-Token", token)
	}
	if source != nil {
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	resp, err := g.client.Do(req)
	if err != nil {
		return errors.New("Skipper временно недоступен")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, responseLimit+1))
	if err != nil || len(data) > responseLimit {
		return errors.New("неверный ответ Skipper")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &failure)
		if failure.Error != "" {
			return errors.New(failure.Error)
		}
		return fmt.Errorf("Skipper HTTP %d", resp.StatusCode)
	}
	if json.Unmarshal(data, out) != nil {
		return errors.New("неверный ответ Skipper")
	}
	return nil
}

func readLine(reader *bufio.Reader, limit int) (string, error) {
	line, err := reader.ReadSlice('\n')
	if err != nil {
		return "", err
	}
	line = bytes.TrimSuffix(line[:len(line)-1], []byte{'\r'})
	if len(line) > limit {
		return "", errors.New("слишком длинная строка")
	}
	return string(line), nil
}

func readSource(reader *bufio.Reader, framing string, begin bool) ([]byte, error) {
	var data []byte
	if begin {
		for {
			line, err := readLine(reader, sourceLimit)
			if err != nil {
				return nil, err
			}
			if line == "." {
				break
			}
			if strings.HasPrefix(line, "..") {
				line = line[1:]
			}
			if len(data)+len(line)+1 > sourceLimit {
				return nil, errors.New("исходник больше 16 384 байт")
			}
			data = append(append(data, line...), '\n')
		}
	} else {
		n, err := strconv.Atoi(framing)
		if err != nil || n < 1 || n > sourceLimit {
			return nil, errors.New("длина исходника от 1 до 16 384 байт")
		}
		data = make([]byte, n)
		if _, err = io.ReadFull(reader, data); err != nil {
			return nil, err
		}
	}
	if len(data) == 0 || !utf8.Valid(data) {
		return nil, errors.New("ожидается непустой исходник UTF-8")
	}
	return data, nil
}

func errorLine(err error) string {
	line := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return ' '
		}
		return r
	}, err.Error())
	runes := []rune(line)
	return "ERR " + string(runes[:min(300, len(runes))])
}

func (g gateway) serve(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	deadline := time.Now().Add(3 * time.Minute)
	_ = conn.SetDeadline(deadline)
	ctx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	reader := bufio.NewReaderSize(conn, sourceLimit+2)
	writer := bufio.NewWriter(conn)
	send := func(message string) bool {
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if _, err := writer.WriteString(message + "\n"); err != nil {
			return false
		}
		return writer.Flush() == nil
	}
	if !send("КАЗНА / ОМСК / ТАКТИКА НА C++20\nAUTH <токен-команды>  |  RULES  |  STATUS\nATTACK <байт>  |  DEFENSE <байт>  |  BEGIN ATTACK/DEFENSE  |  QUIT") {
		return
	}
	var token string
	for {
		line, err := readLine(reader, 1024)
		if err != nil {
			return
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		command := strings.ToUpper(fields[0])
		switch command {
		case "QUIT":
			send("BYE")
			return
		case "HELP":
			if !send("AUTH <токен-команды> | RULES | STATUS | ATTACK <байт> | DEFENSE <байт> | VALIDATE ATTACK/DEFENSE <байт> | BEGIN ATTACK/DEFENSE (конец: строка с точкой) | QUIT") {
				return
			}
			continue
		case "AUTH":
			token = ""
			var status submissions
			if len(fields) != 2 || g.request(ctx, "/submissions", fields[1], nil, &status) != nil || status.TeamID <= 0 {
				if !send("ERR AUTH") {
					return
				}
				continue
			}
			token = fields[1]
			if !send(fmt.Sprintf("OK AUTH team=%d", status.TeamID)) {
				return
			}
			continue
		case "RULES":
			if !send(g.rules(ctx)) {
				return
			}
			continue
		}
		if token == "" {
			if !send("ERR сначала выполните AUTH") {
				return
			}
			continue
		}
		if command == "STATUS" {
			if !send(g.status(ctx, token)) {
				return
			}
			continue
		}
		begin, validate := command == "BEGIN", command == "VALIDATE"
		kind := command
		if begin || validate {
			if len(fields) < 2 {
				if !send("ERR укажите ATTACK или DEFENSE") {
					return
				}
				continue
			}
			kind = strings.ToUpper(fields[1])
		}
		if role[kind] == "" || !validate && len(fields) != 2 || validate && len(fields) != 3 {
			if !send("ERR неверная команда отправки программы") {
				return
			}
			continue
		}
		program, err := readSource(reader, fields[len(fields)-1], begin)
		if err != nil {
			send(errorLine(err))
			return // framing cannot be recovered reliably after a partial program
		}
		if !send(g.upload(ctx, token, kind, program, validate)) {
			return
		}
	}
}

func (g gateway) rules(ctx context.Context) string {
	type announcement struct {
		Epoch          *int            `json:"epoch"`
		EffectiveRound int             `json:"effective_round"`
		AnnouncedRound int             `json:"announced_round"`
		EndRound       int             `json:"end_round,omitempty"`
		Rules          json.RawMessage `json:"rules"`
		Note           string          `json:"note,omitempty"`
	}
	var schedule struct {
		Round         int            `json:"round"`
		Announcements []announcement `json:"announcements"`
		RoundTime     int            `json:"round_time,omitempty"`
		RoundCount    int            `json:"round_count,omitempty"`
		PeriodRounds  int            `json:"period_rounds,omitempty"`
	}
	if err := g.request(ctx, "/rules", "", nil, &schedule); err != nil {
		return errorLine(err)
	}
	sort.SliceStable(schedule.Announcements, func(a, b int) bool {
		return schedule.Announcements[a].EffectiveRound < schedule.Announcements[b].EffectiveRound
	})
	current := -1
	for i := range schedule.Announcements {
		rule := &schedule.Announcements[i]
		if rule.Epoch == nil {
			epoch := i
			if schedule.PeriodRounds > 0 {
				epoch = (rule.EffectiveRound - 1) / schedule.PeriodRounds
			}
			rule.Epoch = &epoch
		}
		if rule.EndRound == 0 && i+1 < len(schedule.Announcements) {
			rule.EndRound = schedule.Announcements[i+1].EffectiveRound - 1
		}
		if rule.EffectiveRound <= schedule.Round {
			current = i
		}
	}
	visible := make([]announcement, 0, len(schedule.Announcements))
	for i, rule := range schedule.Announcements {
		if rule.EffectiveRound > schedule.Round || i == current && (rule.EndRound == 0 || schedule.Round <= rule.EndRound) {
			visible = append(visible, rule)
		}
	}
	schedule.Announcements = visible
	data, err := json.Marshal(schedule)
	if err != nil {
		return errorLine(errors.New("неверные правила Skipper"))
	}
	return "OK RULES " + string(data)
}

func (g gateway) status(ctx context.Context, token string) string {
	var status submissions
	if err := g.request(ctx, "/submissions", token, nil, &status); err != nil {
		return errorLine(err)
	}
	out := fmt.Sprintf("OK STATUS team=%d", status.TeamID)
	for _, kind := range []string{"ATTACK", "DEFENSE"} {
		label := "NONE"
		for _, item := range status.Submissions {
			if item.Role == role[kind] {
				label = fmt.Sprintf("round:%d,sha:%s", item.FromRound, item.SHA256[:min(12, len(item.SHA256))])
				break
			}
		}
		out += " " + kind + "=" + label
	}
	return out
}

func (g gateway) upload(ctx context.Context, token, kind string, program []byte, validate bool) string {
	query := "?role=" + role[kind]
	if validate {
		var result struct {
			Valid      bool   `json:"valid"`
			Diagnostic string `json:"diagnostic"`
			Recruits   int    `json:"recruits"`
			Spent      int    `json:"spent"`
		}
		if err := g.request(ctx, "/validate"+query, token, program, &result); err != nil {
			return errorLine(err)
		}
		if !result.Valid {
			if result.Diagnostic == "" {
				result.Diagnostic = "программа не прошла проверку"
			}
			return errorLine(errors.New(result.Diagnostic))
		}
		return fmt.Sprintf("OK VALIDATE %s recruits=%d spent=%d", kind, result.Recruits, result.Spent)
	}
	var result submission
	if err := g.request(ctx, "/submissions"+query, token, program, &result); err != nil {
		return errorLine(err)
	}
	return fmt.Sprintf("OK %s round=%d sha256=%s", kind, result.FromRound, result.SHA256)
}

func environment(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func main() {
	upstream, err := url.Parse(environment("ARENA_SKIPPER_URL", "http://skipper:8080"))
	if err != nil || upstream.Hostname() == "" || upstream.User != nil || upstream.RawQuery != "" || upstream.Fragment != "" || (upstream.Scheme != "http" && upstream.Scheme != "https") {
		log.Fatal("неверный ARENA_SKIPPER_URL")
	}
	task := environment("ARENA_TASK", "treasury")
	if !taskName.MatchString(task) {
		log.Fatal("неверный ARENA_TASK")
	}
	g := gateway{api: strings.TrimRight(upstream.String(), "/") + "/api/v1/arena/" + task,
		client: &http.Client{Timeout: 55 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	listener, err := net.Listen("tcp", environment("ARENA_TERMINAL_ADDR", ":31337"))
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	go func() { <-ctx.Done(); _ = listener.Close() }()
	slots := make(chan struct{}, 64)
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() == nil {
				log.Fatal(err)
			}
			return
		}
		select {
		case slots <- struct{}{}:
			go func() {
				defer func() { <-slots }()
				g.serve(ctx, conn)
			}()
		default:
			_ = conn.SetWriteDeadline(time.Now().Add(time.Second))
			_, _ = io.WriteString(conn, "ERR терминал занят, повторите позже\n")
			_ = conn.Close()
		}
	}
}
