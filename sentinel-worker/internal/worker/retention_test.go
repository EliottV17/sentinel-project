package worker

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type retentionExecFunc func(context.Context, string, ...any) (pgconn.CommandTag, error)

func (f retentionExecFunc) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	return f(ctx, query, args...)
}

func TestRetentionBatchCutoffsLimitsAndIndependentWindows(t *testing.T) {
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	var queries []string
	var argsByQuery [][]any
	exec := retentionExecFunc(func(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
		if _, ok := ctx.Deadline(); !ok {
			t.Fatal("retention query missing per-batch deadline")
		}
		queries = append(queries, query)
		argsByQuery = append(argsByQuery, args)
		if strings.Contains(query, `"check_result"`) || strings.Contains(query, "check_result") {
			if len(queries)%2 == 1 {
				return pgconn.NewCommandTag("DELETE 25"), nil
			}
		} else if len(queries)%2 == 1 {
			return pgconn.NewCommandTag("DELETE 25"), nil
		}
		return pgconn.NewCommandTag("DELETE 3"), nil
	})
	cfg := RetentionConfig{CheckResultDays: 30, AlertDays: 90, BatchSize: 25, MaxBatchesPerPass: 2, DBTimeout: time.Second}
	if err := RunRetentionPass(context.Background(), exec, cfg, func() time.Time { return now }); err != nil {
		t.Fatal(err)
	}
	if len(queries) != 4 {
		t.Fatalf("query count=%d want bounded 4", len(queries))
	}
	for i, query := range queries {
		if !strings.Contains(query, "WITH doomed AS") || !strings.Contains(query, "FOR UPDATE SKIP LOCKED") || !strings.Contains(query, "LIMIT $2") {
			t.Fatalf("query %d is not a bounded skip-locked delete: %s", i, query)
		}
		if i < 2 {
			if !strings.Contains(query, "FROM check_result") || argsByQuery[i][0] != now.Add(-30*24*time.Hour) {
				t.Fatalf("check cutoff/query incorrect: %s %#v", query, argsByQuery[i])
			}
		} else if !strings.Contains(query, "FROM alert") || argsByQuery[i][0] != now.Add(-90*24*time.Hour) {
			t.Fatalf("alert cutoff/query incorrect: %s %#v", query, argsByQuery[i])
		}
		if argsByQuery[i][1] != 25 {
			t.Fatalf("batch limit=%v want 25", argsByQuery[i][1])
		}
	}
}

func TestRetentionPacesFullBatches(t *testing.T) {
	call := 0
	started := time.Now()
	err := RunRetentionPass(context.Background(), retentionExecFunc(func(context.Context, string, ...any) (pgconn.CommandTag, error) {
		call++
		if call == 1 {
			return pgconn.NewCommandTag("DELETE 2"), nil
		}
		return pgconn.NewCommandTag("DELETE 0"), nil
	}), RetentionConfig{CheckResultDays: 30, AlertDays: 90, BatchSize: 2, MaxBatchesPerPass: 2, DBTimeout: time.Second}, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed < retentionBatchPacing {
		t.Fatalf("full batch was not paced: elapsed=%s", elapsed)
	}
}

func TestRetentionPassHonorsCancellationAndDBTimeout(t *testing.T) {
	t.Run("caller cancellation", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		err := RunRetentionPass(ctx, retentionExecFunc(func(ctx context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
			t.Fatal("query ran after cancellation")
			return pgconn.CommandTag{}, nil
		}), RetentionConfig{CheckResultDays: 30, AlertDays: 90, BatchSize: 1, MaxBatchesPerPass: 1, DBTimeout: time.Second}, time.Now)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error=%v want cancellation", err)
		}
	})
	t.Run("deadline reaches executor", func(t *testing.T) {
		err := RunRetentionPass(context.Background(), retentionExecFunc(func(ctx context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
			<-ctx.Done()
			return pgconn.CommandTag{}, ctx.Err()
		}), RetentionConfig{CheckResultDays: 30, AlertDays: 90, BatchSize: 1, MaxBatchesPerPass: 1, DBTimeout: 10 * time.Millisecond}, time.Now)
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("error=%v want deadline", err)
		}
	})
}

func TestRetentionSchedulingPacingAndShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		runRetentionLoop(ctx, time.Millisecond, func(ctx context.Context) error {
			calls++
			if calls == 2 {
				cancel()
			}
			return nil
		})
	}()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("retention loop did not stop after cancellation")
	}
	if calls != 2 {
		t.Fatalf("pass count=%d want 2 scheduled passes", calls)
	}
}

func TestRetentionPostgresIntegration(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	parsed, err := pgx.ParseConfig(databaseURL)
	if err != nil || parsed.Database != "sentinel_tests_db" || (parsed.Host != "127.0.0.1" && parsed.Host != "localhost" && parsed.Host != "::1") {
		t.Fatalf("refusing unsafe TEST_DATABASE_URL; require loopback and database sentinel_tests_db")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("retention_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, `CREATE SCHEMA "`+schema+`"`); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := admin.Exec(cleanupCtx, `DROP SCHEMA "`+schema+`" CASCADE`); err != nil {
			t.Errorf("drop isolated schema: %v", err)
		}
	}()
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	poolConfig.ConnConfig.RuntimeParams["search_path"] = schema
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	fixture := `
		CREATE TABLE users (id INTEGER PRIMARY KEY, is_demo BOOLEAN NOT NULL);
		CREATE TABLE monitor (id INTEGER PRIMARY KEY, name TEXT NOT NULL, last_state TEXT, last_checked_at TIMESTAMP, state TEXT NOT NULL, is_public BOOLEAN NOT NULL, user_id INTEGER NOT NULL);
		CREATE TABLE check_result (id SERIAL PRIMARY KEY, monitor_id INTEGER NOT NULL, state TEXT NOT NULL, created_at TIMESTAMP NOT NULL);
		CREATE TABLE alert (id SERIAL PRIMARY KEY, monitor_id INTEGER NOT NULL, created_at TIMESTAMP NOT NULL);
	`
	if _, err := pool.Exec(ctx, fixture); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../../sentinel-api/prisma/migrations/20261003000000_retention_indexes/migration.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO users VALUES (1, false); INSERT INTO monitor VALUES (1, 'uptime', 'healthy', NOW(), 'Active', true, 1)`); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	checkCutoff := now.Add(-30 * 24 * time.Hour)
	alertCutoff := now.Add(-90 * 24 * time.Hour)
	for i := 0; i < 13; i++ {
		created := checkCutoff.Add(-time.Duration(i+1) * time.Hour)
		if _, err := pool.Exec(ctx, `INSERT INTO check_result (monitor_id,state,created_at) VALUES (1,'unhealthy',$1)`, created); err != nil {
			t.Fatal(err)
		}
	}
	for i, created := range []time.Time{checkCutoff, now.Add(-time.Hour), now} {
		state := "healthy"
		if i == 0 {
			state = "unhealthy"
		}
		if _, err := pool.Exec(ctx, `INSERT INTO check_result (monitor_id,state,created_at) VALUES (1,$1,$2)`, state, created); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 14; i++ {
		created := alertCutoff.Add(-time.Duration(i+1) * time.Hour)
		if _, err := pool.Exec(ctx, `INSERT INTO alert (monitor_id,created_at) VALUES (1,$1)`, created); err != nil {
			t.Fatal(err)
		}
	}
	for _, created := range []time.Time{alertCutoff, now} {
		if _, err := pool.Exec(ctx, `INSERT INTO alert (monitor_id,created_at) VALUES (1,$1)`, created); err != nil {
			t.Fatal(err)
		}
	}
	readProjection := func() (string, *float64) {
		var state string
		var uptime *float64
		err := pool.QueryRow(ctx, `SELECT m.last_state, CASE WHEN checks.total_checks = 0 THEN NULL ELSE checks.healthy_checks::numeric * 100 / checks.total_checks END FROM monitor AS m INNER JOIN users AS u ON u.id=m.user_id CROSS JOIN LATERAL (SELECT COUNT(*) AS total_checks, COUNT(*) FILTER (WHERE cr.state='healthy') AS healthy_checks FROM check_result AS cr WHERE cr.monitor_id=m.id AND cr.created_at >= NOW()-(24 * INTERVAL '1 hour') AND cr.created_at <= NOW()) AS checks WHERE m.state='Active' AND m.is_public=TRUE AND u.is_demo=FALSE`).Scan(&state, &uptime)
		if err != nil {
			t.Fatal(err)
		}
		return state, uptime
	}
	beforeState, beforeUptime := readProjection()
	retention := RetentionConfig{CheckResultDays: 30, AlertDays: 90, BatchSize: 3, MaxBatchesPerPass: 10, DBTimeout: time.Second}
	fixedNow := func() time.Time { return now }
	if err := RunRetentionPass(ctx, pool, retention, fixedNow); err != nil {
		t.Fatal(err)
	}
	var oldChecks, checks, oldAlerts, alerts int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE created_at < $1), count(*) FROM check_result`, checkCutoff).Scan(&oldChecks, &checks); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE created_at < $1), count(*) FROM alert`, alertCutoff).Scan(&oldAlerts, &alerts); err != nil {
		t.Fatal(err)
	}
	if oldChecks != 0 || checks != 3 || oldAlerts != 0 || alerts != 2 {
		t.Fatalf("unexpected retained rows checks old/total=%d/%d alerts old/total=%d/%d", oldChecks, checks, oldAlerts, alerts)
	}
	afterState, afterUptime := readProjection()
	if beforeState != afterState || beforeUptime == nil || afterUptime == nil || *beforeUptime != *afterUptime {
		t.Fatalf("public uptime projection changed: before=%s/%v after=%s/%v", beforeState, beforeUptime, afterState, afterUptime)
	}
	var lastState string
	if err := pool.QueryRow(ctx, `SELECT last_state FROM monitor WHERE id=1`).Scan(&lastState); err != nil || lastState != "healthy" {
		t.Fatalf("monitor state changed: %q err=%v", lastState, err)
	}
	if err := RunRetentionPass(ctx, pool, retention, fixedNow); err != nil {
		t.Fatal(err)
	}
	var checkCount, alertCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM check_result`).Scan(&checkCount); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM alert`).Scan(&alertCount); err != nil {
		t.Fatal(err)
	}
	if checkCount != 3 || alertCount != 2 {
		t.Fatalf("repeat retention changed rows: checks=%d alerts=%d", checkCount, alertCount)
	}
	for _, index := range []string{"ix_check_result_created_at", "ix_alert_created_at"} {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname=$1)`, index).Scan(&exists); err != nil || !exists {
			t.Fatalf("index %s missing: exists=%v err=%v", index, exists, err)
		}
	}
}

func TestRetentionStopsAfterEmptyBatchAndIsIdempotent(t *testing.T) {
	calls := 0
	err := RunRetentionPass(context.Background(), retentionExecFunc(func(context.Context, string, ...any) (pgconn.CommandTag, error) {
		calls++
		return pgconn.NewCommandTag("DELETE 0"), nil
	}), RetentionConfig{CheckResultDays: 30, AlertDays: 90, BatchSize: 10, MaxBatchesPerPass: 5, DBTimeout: time.Second}, time.Now)
	if err != nil || calls != 2 {
		t.Fatalf("empty tables should stop each table after one query: err=%v calls=%d", err, calls)
	}
}
