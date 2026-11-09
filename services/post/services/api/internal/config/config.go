package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Env(key, fallback string) string {
	if path, ok := os.LookupEnv(key + "_FILE"); ok && path != "" {
		bytes, err := os.ReadFile(path)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(bytes))
	}
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func PositiveInt(key string, fallback int) (int, error) {
	value, err := strconv.Atoi(Env(key, strconv.Itoa(fallback)))
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return value, nil
}

func ValidateSecrets(keys ...string) error {
	mode := Env("APP_ENV", "development")
	if mode != "development" && mode != "production" {
		return fmt.Errorf("APP_ENV must be development or production")
	}
	for _, key := range keys {
		value := Env(key, "")
		if value == "" {
			return fmt.Errorf("%s is required", key)
		}
		if mode == "production" && (strings.HasPrefix(value, "local-") || len(value) < 24) {
			return fmt.Errorf("%s must be an explicit non-development secret of at least 24 characters", key)
		}
	}
	return nil
}

func Database() (*pgxpool.Config, error) {
	if err := ValidateSecrets("DB_PASSWORD"); err != nil {
		return nil, err
	}
	cfg, err := pgxpool.ParseConfig("")
	if err != nil {
		return nil, err
	}
	cfg.ConnConfig.Host = Env("DB_HOST", "postgres")
	port, err := PositiveInt("DB_PORT", 5432)
	if err != nil || port > 65535 {
		return nil, fmt.Errorf("invalid DB_PORT")
	}
	cfg.ConnConfig.Port = uint16(port)
	cfg.ConnConfig.Database = Env("DB_NAME", "svyaz")
	cfg.ConnConfig.User = Env("DB_USER", "svyaz_api")
	cfg.ConnConfig.Password = os.Getenv("DB_PASSWORD")
	cfg.ConnConfig.TLSConfig = nil
	cfg.ConnConfig.Fallbacks = nil
	cfg.ConnConfig.ConnectTimeout = 3 * time.Second
	maxConns, err := PositiveInt("DB_MAX_CONNECTIONS", 5)
	if err != nil || maxConns > 100 {
		return nil, fmt.Errorf("DB_MAX_CONNECTIONS must be 1..100")
	}
	cfg.MaxConns = int32(maxConns)
	return cfg, nil
}
