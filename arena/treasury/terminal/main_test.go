package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTerminalProtocol(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/rules" && r.Header.Get("X-Team-Token") != "test-team-token" {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"error":"unauthorized"}`)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/rules":
			fmt.Fprint(w, "{\n\"round\":1,\n\"announcements\":[]}")
		case r.Method == http.MethodGet && r.URL.Path == "/submissions":
			fmt.Fprint(w, `{"team_id":7,"submissions":[{"role":"raider","from_round":2,"sha256":"abcdef1234567890"}]}`)
		case r.Method == http.MethodPost && (r.URL.Path == "/submissions" || r.URL.Path == "/validate"):
			data, err := io.ReadAll(r.Body)
			if err != nil || r.Header.Get("Content-Type") != "application/octet-stream" {
				t.Errorf("invalid upload request: %v", err)
			}
			wantRole, wantData := "raider", "xyz"
			if r.URL.Path == "/validate" {
				wantRole, wantData = "guard", "guard"
			} else if r.URL.Query().Get("role") == "guard" {
				wantRole, wantData = "guard", ".line\n"
			}
			if r.URL.Query().Get("role") != wantRole || string(data) != wantData {
				t.Errorf("expected %s %q, got %s %q", wantRole, wantData, r.URL.Query().Get("role"), data)
			}
			if r.URL.Path == "/validate" {
				fmt.Fprint(w, `{"valid":true,"recruits":5,"spent":23}`)
			} else {
				w.WriteHeader(http.StatusCreated)
				fmt.Fprint(w, `{"from_round":2,"sha256":"abcdef1234567890"}`)
			}
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer api.Close()
	client, server := net.Pipe()
	defer client.Close()
	_ = client.SetDeadline(time.Now().Add(5 * time.Second))
	go gateway{api.URL, api.Client()}.serve(context.Background(), server)
	reader := bufio.NewReader(client)
	expect := func(want string) {
		t.Helper()
		line, err := reader.ReadString('\n')
		if err != nil || strings.TrimSuffix(line, "\n") != want {
			t.Fatalf("expected %q, got %q (%v)", want, line, err)
		}
	}
	for range 3 {
		if _, err := reader.ReadString('\n'); err != nil {
			t.Fatal(err)
		}
	}
	for _, step := range []struct{ send, want string }{
		{"RULES\n", `OK RULES {"round":1,"announcements":[]}`},
		{"STATUS\n", "ERR сначала выполните AUTH"},
		{"AUTH wrong\n", "ERR AUTH"},
		{"AUTH test-team-token\n", "OK AUTH team=7"},
		{"STATUS\n", "OK STATUS team=7 ATTACK=round:2,sha:abcdef123456 DEFENSE=NONE"},
		{"ATTACK 3\nxyz", "OK ATTACK round=2 sha256=abcdef1234567890"},
		{"VALIDATE DEFENSE 5\nguard", "OK VALIDATE DEFENSE recruits=5 spent=23"},
		{"BEGIN DEFENSE\n..line\n.\n", "OK DEFENSE round=2 sha256=abcdef1234567890"},
		{"QUIT\n", "BYE"},
	} {
		if _, err := io.WriteString(client, step.send); err != nil {
			t.Fatal(err)
		}
		expect(step.want)
	}
}

func TestTerminalRulesUsesPublishedBoundaries(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"round":9,"round_time":87,"round_count":21,"period_rounds":7,"announcements":[
			{"effective_round":15,"announced_round":8,"end_round":21,"rules":{"weather":2}},
			{"effective_round":1,"announced_round":0,"end_round":7,"rules":{"weather":0}},
			{"effective_round":8,"announced_round":1,"end_round":14,"rules":{"weather":1}}
		]}`)
	}))
	defer api.Close()
	line := gateway{api.URL, api.Client()}.rules(context.Background())
	var response struct {
		RoundTime     int `json:"round_time"`
		Announcements []struct {
			Epoch          int `json:"epoch"`
			EffectiveRound int `json:"effective_round"`
			EndRound       int `json:"end_round"`
		} `json:"announcements"`
	}
	if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "OK RULES ")), &response); err != nil {
		t.Fatal(err)
	}
	got := response.Announcements
	if response.RoundTime != 87 || len(got) != 2 || got[0].Epoch != 1 || got[0].EffectiveRound != 8 || got[0].EndRound != 14 || got[1].Epoch != 2 || got[1].EffectiveRound != 15 || got[1].EndRound != 21 {
		t.Fatalf("unexpected schedule %s", line)
	}
}
