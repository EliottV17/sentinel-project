package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type demoMonitor struct {
	SeedKey     string          `json:"seed_key"`
	Name        string          `json:"name"`
	Target      string          `json:"target"`
	Frequency   int             `json:"frequency"`
	CheckType   string          `json:"check_type"`
	CheckConfig json.RawMessage `json:"check_config"`
}

type demoResetTx interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Commit(context.Context) error
	Rollback(context.Context) error
}

type demoResetDB interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Begin(context.Context) (demoResetTx, error)
}

type demoResetPool struct{ pool *pgxpool.Pool }

func (d demoResetPool) QueryRow(ctx context.Context, q string, args ...any) pgx.Row {
	return d.pool.QueryRow(ctx, q, args...)
}
func (d demoResetPool) Begin(ctx context.Context) (demoResetTx, error) { return d.pool.Begin(ctx) }

func parseDemoManifest(data []byte) ([]demoMonitor, error) {
	var monitors []demoMonitor
	if err := json.Unmarshal(data, &monitors); err != nil {
		return nil, err
	}
	if len(monitors) == 0 {
		return nil, fmt.Errorf("demo manifest must contain at least one monitor")
	}
	keys := map[string]bool{}
	for _, m := range monitors {
		if m.SeedKey == "" || keys[m.SeedKey] || m.Name == "" || m.Frequency <= 0 || m.CheckType == "" || m.Target == "" {
			return nil, fmt.Errorf("demo manifest contains invalid monitor entry")
		}
		keys[m.SeedKey] = true
	}
	return monitors, nil
}

func resetInterval(minutes int) time.Duration {
	if minutes <= 0 {
		minutes = 60
	}
	return time.Duration(minutes) * time.Minute
}

func resetDemoAccount(ctx context.Context, db demoResetDB, email, manifestPath string) error {
	if email == "" {
		return nil
	}
	if db == nil {
		return errors.New("demo reset database is nil")
	}
	if manifestPath == "" {
		manifestPath = "../demo-monitors.json"
	}
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("read demo manifest: %w", err)
	}
	monitors, err := parseDemoManifest(data)
	if err != nil {
		return fmt.Errorf("parse demo manifest: %w", err)
	}
	var userID int
	err = db.QueryRow(ctx, `SELECT id FROM users WHERE email = $1 AND is_demo = true`, email).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find demo user: %w", err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin demo reset: %w", err)
	}
	defer tx.Rollback(ctx)
	for _, query := range []string{
		`DELETE FROM check_result WHERE monitor_id IN (SELECT id FROM monitor WHERE user_id = $1)`,
		`DELETE FROM alert WHERE monitor_id IN (SELECT id FROM monitor WHERE user_id = $1)`,
		`DELETE FROM monitor WHERE user_id = $1`,
	} {
		if _, err = tx.Exec(ctx, query, userID); err != nil {
			return fmt.Errorf("delete demo-owned data: %w", err)
		}
	}
	for _, m := range monitors {
		if _, err = tx.Exec(ctx, `INSERT INTO monitor (user_id, name, target, check_type, check_config, frequency, state, seed_key, created_at, consecutive_failures) VALUES ($1,$2,$3,$4,$5,$6,'Active',$7,CURRENT_TIMESTAMP,0)`, userID, m.Name, m.Target, m.CheckType, m.CheckConfig, m.Frequency, m.SeedKey); err != nil {
			return fmt.Errorf("restore demo monitor %q: %w", m.SeedKey, err)
		}
	}
	return tx.Commit(ctx)
}

func runDemoResetLoop(ctx context.Context, pool *pgxpool.Pool, email, manifestPath string, interval time.Duration) {
	if email == "" {
		slog.Info("demo reset disabled: DEMO_USER_EMAIL is not configured")
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := resetDemoAccount(ctx, demoResetPool{pool}, email, manifestPath); err != nil {
				slog.Error("demo reset failed", "err", err)
			}
		}
	}
}
