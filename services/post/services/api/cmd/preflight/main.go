package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"svyaz.local/foundation/services/api/internal/config"
)

func main() {
	for _, key := range []string{"IDEMPOTENCY_SECRET", "REALTIME_CAPABILITY_SECRET", "VOICE_CAPABILITY_SECRET", "MEDIA_CAPABILITY_SECRET"} {
		path := os.Getenv(key + "_FILE")
		if path == "" {
			continue
		}
		if _, err := os.Stat(path); err == nil {
			if err := os.Chown(path, 65532, 65532); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			continue
		} else if !os.IsNotExist(err) {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if err := os.WriteFile(path, []byte(hex.EncodeToString(raw)), 0600); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if err := os.Chown(path, 65532, 65532); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	if err := config.ValidateSecrets("POSTGRES_PASSWORD", "API_DB_PASSWORD", "REALTIME_DB_PASSWORD", "MEDIA_DB_PASSWORD", "VOICE_DB_PASSWORD", "REDIS_PASSWORD", "S3_ROOT_PASSWORD", "S3_MEDIA_PASSWORD", "IDEMPOTENCY_SECRET", "REALTIME_CAPABILITY_SECRET", "VOICE_CAPABILITY_SECRET", "MEDIA_CAPABILITY_SECRET"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Configuration preflight passed")
}
