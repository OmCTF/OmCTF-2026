package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"svyaz.local/foundation/services/api/internal/config"
	"svyaz.local/foundation/services/api/internal/guild"
	"svyaz.local/foundation/services/api/internal/httpapi"
	"svyaz.local/foundation/services/api/internal/identity"
	"svyaz.local/foundation/services/api/internal/migrations"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("startup_failed", "service", "api", "error", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Database()
	if err != nil {
		return err
	}
	if err = config.ValidateSecrets("REDIS_PASSWORD"); err != nil {
		return err
	}
	healthMS, err := config.PositiveInt("HEALTH_TIMEOUT_MS", 1500)
	if err != nil {
		return err
	}
	httpMS, err := config.PositiveInt("HTTP_TIMEOUT_MS", 5000)
	if err != nil || httpMS <= healthMS {
		return fmt.Errorf("HTTP_TIMEOUT_MS must exceed HEALTH_TIMEOUT_MS")
	}
	bodySize, err := config.PositiveInt("MAX_BODY_BYTES", 1048576)
	if err != nil {
		return err
	}
	port, err := config.PositiveInt("HTTP_PORT", 8080)
	if err != nil || port > 65535 {
		return fmt.Errorf("invalid HTTP_PORT")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("database configuration invalid")
	}
	defer pool.Close()
	redisClient := redis.NewClient(&redis.Options{Addr: config.Env("REDIS_ADDR", "redis:6379"), Password: os.Getenv("REDIS_PASSWORD"), DialTimeout: time.Duration(healthMS) * time.Millisecond, ReadTimeout: time.Duration(healthMS) * time.Millisecond, WriteTimeout: time.Duration(healthMS) * time.Millisecond, ContextTimeoutEnabled: true, MaxRetries: -1})
	defer redisClient.Close()
	identityHandler, err := identity.New(pool, redisClient, logger)
	if err != nil {
		return err
	}
	defer identityHandler.Close()
	if err = config.ValidateSecrets("REALTIME_CAPABILITY_SECRET", "VOICE_CAPABILITY_SECRET", "MEDIA_CAPABILITY_SECRET"); err != nil {
		return err
	}
	guildHandler := &guild.Server{DB: pool, RealtimeSecret: config.Env("REALTIME_CAPABILITY_SECRET", ""), VoiceSecret: config.Env("VOICE_CAPABILITY_SECRET", ""), MediaSecret: config.Env("MEDIA_CAPABILITY_SECRET", "")}
	identityHandler.Business = guildHandler.Handle
	identityHandler.Webhook = guildHandler.ExecuteWebhook
	go guildHandler.RunCommunity(ctx, logger)
	handler := httpapi.Server{Version: config.Env("APP_VERSION", "0.1.0"), Timeout: time.Duration(healthMS) * time.Millisecond, MaxBodyBytes: int64(bodySize), Logger: logger, Probes: map[string]httpapi.Probe{
		"postgres": func(ctx context.Context) error {
			var version int
			if err := pool.QueryRow(ctx, "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1").Scan(&version); err != nil {
				return err
			}
			if version != migrations.CurrentVersion {
				return fmt.Errorf("migration version mismatch")
			}
			return nil
		},
		"redis": func(ctx context.Context) error { return redisClient.Ping(ctx).Err() },
	}}
	handler.Identity = identityHandler
	server := &http.Server{Addr: fmt.Sprintf(":%d", port), Handler: handler, ReadHeaderTimeout: time.Duration(httpMS) * time.Millisecond, ReadTimeout: time.Duration(httpMS) * time.Millisecond, WriteTimeout: time.Duration(httpMS) * time.Millisecond, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	done := make(chan error, 1)
	go func() { logger.Info("listening", "service", "api", "port", port); done <- server.ListenAndServe() }()
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}
