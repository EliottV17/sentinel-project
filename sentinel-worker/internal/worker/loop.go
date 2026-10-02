// Package worker implements the polling loop that checks due monitors and
// persists the results to the shared PostgreSQL database; it is the sole polling
// engine (the API is REST-only).
package worker

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/EliottV17/sentinel-worker/internal/checker"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Run(ctx context.Context, pool *pgxpool.Pool, concurrency int, demoEmail, manifestPath string, resetMinutes int) {
	if concurrency <= 0 {
		concurrency = 10
	}
	sem := make(chan struct{}, concurrency)
	resetDone := make(chan struct{})
	go func() {
		defer close(resetDone)
		runDemoResetLoop(ctx, pool, demoEmail, manifestPath, resetInterval(resetMinutes))
	}()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	defer func() { <-resetDone }()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			monitors, err := fetchDueMonitors(ctx, pool)
			if err != nil {
				slog.Error("fetchDueMonitors error", "err", err)
				continue
			}
			for _, m := range monitors {
				sem <- struct{}{}
				go func(mon checker.Monitor) {
					defer func() { <-sem }()
					checkAndPersist(ctx, pool, mon)
				}(m)
			}
		}
	}
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

func fetchDueMonitors(ctx context.Context, pool *pgxpool.Pool) ([]checker.Monitor, error) {
	rows, err := pool.Query(ctx, `
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

func checkAndPersist(ctx context.Context, pool *pgxpool.Pool, m checker.Monitor) {
	c, err := checker.Get(m.CheckType)
	if err != nil {
		slog.Error("unknown checker type", "check_type", m.CheckType, "monitor_id", m.ID)
		return
	}

	result, err := c.Check(ctx, m)
	if err != nil {
		slog.Error("check error", "monitor_id", m.ID, "target", m.Target, "err", err)
		return
	}

	now := time.Now().UTC()

	inserted := insertResult(ctx, pool, `
		INSERT INTO check_result (monitor_id, state, status_code, latency_ms, response_sample, error_message, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, []any{m.ID, result.State, result.StatusCode, result.LatencyMs, result.ResponseSample, result.ErrorMessage, now})
	if inserted.outcome != insertSucceeded {
		if inserted.outcome == insertMonitorDeleted {
			slog.Warn("check result ignored because monitor was deleted during check", "monitor_id", m.ID)
		} else {
			slog.Error("insert check_result error", "monitor_id", m.ID, "err", inserted.err)
		}
		return
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

	_, err = pool.Exec(ctx, `
		UPDATE monitor
		SET last_state = $1, last_checked_at = $4, consecutive_failures = $2
		WHERE id = $3
	`, newState, consecutiveFailures, m.ID, now)
	if err != nil {
		slog.Error("update monitor error", "monitor_id", m.ID, "err", err)
	}

	if oldState != nil && *oldState != newState {
		alertType := "down"
		message := m.Name + " esta caído"
		if newState == "healthy" {
			alertType = "recovery"
			message = m.Name + " se recuperó"
		}

		alertInsert := insertAlert(ctx, pool, `
			INSERT INTO alert (monitor_id, alert_type, message, created_at)
			VALUES ($1, $2, $3, $4)
		`, []any{m.ID, alertType, message, now})
		if alertInsert.outcome != insertSucceeded {
			if alertInsert.outcome == insertMonitorDeleted {
				slog.Warn("alert ignored because monitor was deleted during check", "monitor_id", m.ID)
			} else {
				slog.Error("insert alert error", "monitor_id", m.ID, "err", alertInsert.err)
			}
		} else {
			slog.Info("state transition alert emitted",
				"monitor_id", m.ID,
				"alertType", alertType,
				"old_state", *oldState,
				"new_state", newState,
			)
		}
	}
}
