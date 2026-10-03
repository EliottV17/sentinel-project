// Package main is the entrypoint for the Sentinel worker.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/EliottV17/sentinel-worker/internal/checker"
	"github.com/EliottV17/sentinel-worker/internal/config"
	"github.com/EliottV17/sentinel-worker/internal/db"
	"github.com/EliottV17/sentinel-worker/internal/health"
	"github.com/EliottV17/sentinel-worker/internal/worker"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("Invalid worker configuration", "err", err)
		os.Exit(1)
	}
	if len(os.Args) > 1 && os.Args[1] == "health" {
		if err := runHealth(cfg); err != nil {
			slog.Error("worker health check failed", "err", err)
			os.Exit(1)
		}
		return
	}

	if err := health.ResetHeartbeat(cfg.HeartbeatPath); err != nil {
		slog.Error("invalidate worker heartbeat", "err", err)
		os.Exit(1)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("Database connection failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	allowedPorts := checker.ParseAllowedPorts(cfg.AllowedPorts)
	checker.Register("http", checker.NewHTTPChecker(allowedPorts))

	slog.Info("Sentinel worker started")
	worker.RunWithRetention(ctx, pool, cfg.Concurrency, cfg.DemoUserEmail, cfg.DemoManifestPath, cfg.DemoResetInterval, cfg.HeartbeatPath, cfg.DBOperationTimeout, worker.RetentionConfig{
		CheckResultDays:   cfg.CheckResultRetentionDays,
		AlertDays:         cfg.AlertRetentionDays,
		BatchSize:         cfg.RetentionBatchSize,
		MaxBatchesPerPass: 10,
		DBTimeout:         cfg.RetentionDBTimeout,
	}, time.Duration(cfg.RetentionIntervalMinutes)*time.Minute)
	slog.Info("Sentinel worker stopped")
}

func runHealth(cfg config.Config) error {
	if err := health.CheckHeartbeat(cfg.HeartbeatPath, time.Now().UTC(), cfg.HeartbeatMaxAge); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), cfg.HealthDBTimeout)
	defer cancel()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	return health.Check(ctx, cfg.HeartbeatPath, cfg.HeartbeatMaxAge, cfg.HealthDBTimeout, pool)
}
