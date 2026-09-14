// Package main is the entrypoint for the Sentinel worker.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/EliottV17/sentinel-worker/internal/checker"
	"github.com/EliottV17/sentinel-worker/internal/config"
	"github.com/EliottV17/sentinel-worker/internal/db"
	"github.com/EliottV17/sentinel-worker/internal/worker"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)
	
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	cfg := config.Load()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("Database connection failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	checker.Register("http", &checker.HTTPChecker{Client: &http.Client{Timeout: 10 * time.Second}})

	slog.Info("Sentinel worker started")
	worker.Run(ctx, pool, cfg.Concurrency)
	slog.Info("Sentinel worker stopped")
}
