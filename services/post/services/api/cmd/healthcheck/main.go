package main

import (
	"io"
	"net/http"
	"os"
	"time"
)

func main() {
	target := os.Getenv("HEALTH_URL")
	if len(os.Args) == 2 {
		target = os.Args[1]
	}
	if target == "" {
		port := os.Getenv("HTTP_PORT")
		if port == "" {
			port = "8080"
		}
		target = "http://127.0.0.1:" + port + "/health/ready"
	}
	client := &http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get(target)
	if err != nil {
		os.Exit(1)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		os.Exit(1)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 65536))
}
