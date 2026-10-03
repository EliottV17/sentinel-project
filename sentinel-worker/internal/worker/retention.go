package worker

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

const (
	retentionMaxBatchesPerPass = 10
	retentionBatchPacing       = 50 * time.Millisecond
)

type RetentionConfig struct {
	CheckResultDays   int
	AlertDays         int
	BatchSize         int
	MaxBatchesPerPass int
	DBTimeout         time.Duration
}

type retentionExecer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

type retentionTable struct {
	name string
	days int
}

func RunRetentionPass(ctx context.Context, exec retentionExecer, cfg RetentionConfig, now func() time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if cfg.CheckResultDays <= 0 || cfg.AlertDays <= 0 || cfg.BatchSize <= 0 || cfg.MaxBatchesPerPass <= 0 || cfg.DBTimeout <= 0 {
		return fmt.Errorf("invalid retention configuration")
	}
	if cfg.MaxBatchesPerPass > retentionMaxBatchesPerPass {
		cfg.MaxBatchesPerPass = retentionMaxBatchesPerPass
	}
	if now == nil {
		now = time.Now
	}
	for _, table := range []retentionTable{{name: "check_result", days: cfg.CheckResultDays}, {name: "alert", days: cfg.AlertDays}} {
		if err := cleanRetentionTable(ctx, exec, table, cfg, now); err != nil {
			return fmt.Errorf("retain %s: %w", table.name, err)
		}
	}
	return nil
}

func cleanRetentionTable(ctx context.Context, exec retentionExecer, table retentionTable, cfg RetentionConfig, now func() time.Time) error {
	// Names are compile-time constants, never supplied by configuration.
	if table.name != "check_result" && table.name != "alert" {
		return fmt.Errorf("unsupported retention table %q", table.name)
	}
	query := fmt.Sprintf(`
		WITH doomed AS (
			SELECT id FROM %s
			WHERE created_at < $1
			ORDER BY created_at, id
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		DELETE FROM %s AS retained
		USING doomed
		WHERE retained.id = doomed.id`, table.name, table.name)
	for batch := 0; batch < cfg.MaxBatchesPerPass; batch++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		cutoff := now().Add(-time.Duration(table.days) * 24 * time.Hour)
		dbCtx, cancel := context.WithTimeout(ctx, cfg.DBTimeout)
		tag, err := exec.Exec(dbCtx, query, cutoff, cfg.BatchSize)
		cancel()
		if err != nil {
			return err
		}
		if tag.RowsAffected() < int64(cfg.BatchSize) {
			return nil
		}
		if batch+1 < cfg.MaxBatchesPerPass {
			timer := time.NewTimer(retentionBatchPacing)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
	}
	return nil
}

func runRetentionLoop(ctx context.Context, interval time.Duration, pass func(context.Context) error) {
	if interval <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := pass(ctx); err != nil && ctx.Err() == nil {
				slog.Error("retention pass failed", "err", strings.TrimSpace(err.Error()))
			}
		}
	}
}
