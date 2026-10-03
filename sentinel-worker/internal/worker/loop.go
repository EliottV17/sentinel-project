// Package worker implements the polling loop that checks due monitors and
// persists the results to the shared PostgreSQL database; it is the sole polling
// engine (the API is REST-only).
package worker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/EliottV17/sentinel-worker/internal/checker"
	"github.com/EliottV17/sentinel-worker/internal/health"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultDBOperationTimeout = 10 * time.Second

func boundedDBOperation(ctx context.Context, timeout time.Duration, operation func(context.Context) error) error {
	dbCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return operation(dbCtx)
}

func Run(ctx context.Context, pool *pgxpool.Pool, concurrency int, demoEmail, manifestPath string, resetMinutes int) {
	RunWithHealth(ctx, pool, concurrency, demoEmail, manifestPath, resetMinutes, "/tmp/sentinel-worker.heartbeat", defaultDBOperationTimeout)
}

func RunWithHealth(ctx context.Context, pool *pgxpool.Pool, concurrency int, demoEmail, manifestPath string, resetMinutes int, heartbeatPath string, dbTimeout time.Duration) {
	runWithHealth(ctx, pool, concurrency, demoEmail, manifestPath, resetMinutes, heartbeatPath, dbTimeout, nil, 0)
}

func RunWithRetention(ctx context.Context, pool *pgxpool.Pool, concurrency int, demoEmail, manifestPath string, resetMinutes int, heartbeatPath string, dbTimeout time.Duration, retention RetentionConfig, retentionInterval time.Duration) {
	runWithHealth(ctx, pool, concurrency, demoEmail, manifestPath, resetMinutes, heartbeatPath, dbTimeout, &retention, retentionInterval)
}

func runWithHealth(ctx context.Context, pool *pgxpool.Pool, concurrency int, demoEmail, manifestPath string, resetMinutes int, heartbeatPath string, dbTimeout time.Duration, retention *RetentionConfig, retentionInterval time.Duration) {
	if concurrency <= 0 {
		concurrency = 10
	}
	if dbTimeout <= 0 {
		dbTimeout = defaultDBOperationTimeout
	}
	resetDone := make(chan struct{})
	go func() {
		defer close(resetDone)
		runDemoResetLoop(ctx, pool, demoEmail, manifestPath, resetInterval(resetMinutes), dbTimeout)
	}()
	var retentionDone chan struct{}
	if retention != nil {
		retentionDone = make(chan struct{})
		go func() {
			defer close(retentionDone)
			runRetentionLoop(ctx, retentionInterval, func(passCtx context.Context) error {
				return RunRetentionPass(passCtx, pool, *retention, time.Now)
			})
		}()
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	defer func() {
		<-resetDone
		if retentionDone != nil {
			<-retentionDone
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			err := runPollCycle(ctx, concurrency,
				func(cycleCtx context.Context) ([]checker.Monitor, error) {
					return fetchDueMonitors(cycleCtx, pgxPoolMonitorQuerier{pool}, dbTimeout)
				},
				func(workCtx context.Context, monitor checker.Monitor) error {
					return checkAndPersist(workCtx, pool, monitor, dbTimeout)
				},
				func() {
					if err := health.WriteHeartbeat(heartbeatPath, time.Now()); err != nil {
						slog.Error("write worker heartbeat", "err", err)
					}
				},
			)
			if err != nil && !errors.Is(err, context.Canceled) {
				slog.Error("poll cycle failed", "err", err)
			}
		}
	}
}

func runPollCycle[T any](ctx context.Context, concurrency int, fetch func(context.Context) ([]T, error), work func(context.Context, T) error, heartbeat func()) error {
	if concurrency < 1 {
		concurrency = 1
	}
	items, err := fetch(ctx)
	if err != nil {
		return fmt.Errorf("fetch due monitors: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(items) == 0 {
		heartbeat()
		return nil
	}

	type workResult struct{ err error }
	results := make(chan workResult, len(items))
	active := 0
	next := 0
	startWork := func(item T) {
		active++
		go func() { results <- workResult{err: work(ctx, item)} }()
	}
	for next < len(items) && active < concurrency {
		startWork(items[next])
		next++
	}
	var workErrors []error
	for active > 0 {
		if ctx.Err() != nil {
			for active > 0 {
				<-results
				active--
			}
			return ctx.Err()
		}
		select {
		case <-ctx.Done():
		case result := <-results:
			active--
			if result.err == nil || isMonitorCheckError(result.err) {
				heartbeat()
			} else {
				workErrors = append(workErrors, result.err)
			}
			if ctx.Err() == nil && next < len(items) {
				startWork(items[next])
				next++
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := errors.Join(workErrors...); err != nil {
		return fmt.Errorf("dispatch monitor checks: %w", err)
	}
	return nil
}

type monitorCheckError struct{ err error }

func (e monitorCheckError) Error() string { return e.err.Error() }
func (e monitorCheckError) Unwrap() error { return e.err }

func isMonitorCheckError(err error) bool {
	var checkErr monitorCheckError
	return errors.As(err, &checkErr)
}

type insertOutcome int

const (
	insertSucceeded insertOutcome = iota
	insertMonitorDeleted
	insertFailed
)

type insertResultValue struct {
	outcome insertOutcome
	err     error
}

type resultExecer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func insertResult(ctx context.Context, exec resultExecer, query string, args []any) insertResultValue {
	_, err := exec.Exec(ctx, query, args...)
	return classifyInsertError(err)
}

func classifyInsertError(err error) insertResultValue {
	if err == nil {
		return insertResultValue{outcome: insertSucceeded}
	}
	if isConcurrentDeleteForeignKey(err) {
		return insertResultValue{outcome: insertMonitorDeleted}
	}
	return insertResultValue{outcome: insertFailed, err: err}
}

func insertAlert(ctx context.Context, exec resultExecer, query string, args []any) insertResultValue {
	return insertResult(ctx, exec, query, args)
}

func isConcurrentDeleteForeignKey(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

type monitorRows interface {
	Next() bool
	Scan(...any) error
	Err() error
	Close()
}

type monitorQuerier interface {
	Query(context.Context, string, ...any) (monitorRows, error)
}

type pgxPoolMonitorQuerier struct{ pool *pgxpool.Pool }

type pgxMonitorRows struct{ pgx.Rows }

func (q pgxPoolMonitorQuerier) Query(ctx context.Context, query string, args ...any) (monitorRows, error) {
	rows, err := q.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	return pgxMonitorRows{Rows: rows}, nil
}

func fetchDueMonitors(ctx context.Context, pool monitorQuerier, timeout time.Duration) ([]checker.Monitor, error) {
	dbCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	rows, err := pool.Query(dbCtx, `
		SELECT id, name, target, check_type, check_config, frequency,
		       last_state, last_checked_at, consecutive_failures
		FROM monitor
		WHERE state = 'Active'
		  AND (last_checked_at IS NULL OR last_checked_at + (frequency || ' seconds')::interval <= NOW())
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var monitors []checker.Monitor
	for rows.Next() {
		var m checker.Monitor
		if err := rows.Scan(&m.ID, &m.Name, &m.Target, &m.CheckType, &m.CheckConfig,
			&m.Frequency, &m.LastState, &m.LastCheckedAt, &m.ConsecutiveFailures); err != nil {
			return monitors, err
		}
		monitors = append(monitors, m)
	}
	return monitors, rows.Err()
}

func checkAndPersist(ctx context.Context, pool resultExecer, m checker.Monitor, timeout time.Duration) error {
	c, err := checker.Get(m.CheckType)
	if err != nil {
		slog.Error("unknown checker type", "check_type", m.CheckType, "monitor_id", m.ID)
		return monitorCheckError{err: err}
	}

	result, err := c.Check(ctx, m)
	if err != nil {
		slog.Error("check error", "monitor_id", m.ID, "target", m.Target, "err", err)
		return monitorCheckError{err: err}
	}

	now := time.Now().UTC()
	inserted := insertResultWithTimeout(ctx, pool, timeout, `
		INSERT INTO check_result (monitor_id, state, status_code, latency_ms, response_sample, error_message, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, []any{m.ID, result.State, result.StatusCode, result.LatencyMs, result.ResponseSample, result.ErrorMessage, now})
	if inserted.outcome != insertSucceeded {
		if inserted.outcome == insertMonitorDeleted {
			slog.Warn("check result ignored because monitor was deleted during check", "monitor_id", m.ID)
			return nil
		}
		slog.Error("insert check_result error", "monitor_id", m.ID, "err", inserted.err)
		return inserted.err
	}

	slog.Info("check completed",
		"monitor_id", m.ID,
		"target", m.Target,
		"state", result.State,
		"status_code", result.StatusCode,
		"latency_ms", result.LatencyMs)
	newState := result.State
	var oldState *string
	if m.LastState != nil {
		oldState = m.LastState
	}
	consecutiveFailures := m.ConsecutiveFailures
	if newState == "healthy" {
		consecutiveFailures = 0
	} else {
		consecutiveFailures++
	}

	var updateErr error
	if err := boundedDBOperation(ctx, timeout, func(dbCtx context.Context) error {
		_, updateErr = pool.Exec(dbCtx, `
			UPDATE monitor
			SET last_state = $1, last_checked_at = $4, consecutive_failures = $2
			WHERE id = $3
		`, newState, consecutiveFailures, m.ID, now)
		return updateErr
	}); err != nil {
		slog.Error("update monitor error", "monitor_id", m.ID, "err", err)
		return err
	}
	if oldState == nil || *oldState == newState {
		return nil
	}

	alertType := "down"
	message := m.Name + " esta caído"
	if newState == "healthy" {
		alertType = "recovery"
		message = m.Name + " se recuperó"
	}
	alertInsert := insertResultWithTimeout(ctx, pool, timeout, `
		INSERT INTO alert (monitor_id, alert_type, message, created_at)
		VALUES ($1, $2, $3, $4)
	`, []any{m.ID, alertType, message, now})
	if alertInsert.outcome != insertSucceeded {
		if alertInsert.outcome == insertMonitorDeleted {
			slog.Warn("alert ignored because monitor was deleted during check", "monitor_id", m.ID)
			return nil
		}
		slog.Error("insert alert error", "monitor_id", m.ID, "err", alertInsert.err)
		return alertInsert.err
	}
	slog.Info("state transition alert emitted",
		"monitor_id", m.ID,
		"alertType", alertType,
		"old_state", *oldState,
		"new_state", newState)
	return nil
}

func insertResultWithTimeout(ctx context.Context, exec resultExecer, timeout time.Duration, query string, args []any) insertResultValue {
	var result insertResultValue
	if err := boundedDBOperation(ctx, timeout, func(dbCtx context.Context) error {
		result = insertResult(dbCtx, exec, query, args)
		return result.err
	}); err != nil && result.err == nil {
		result = classifyInsertError(err)
	}
	return result
}
