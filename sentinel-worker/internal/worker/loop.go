// Package worker implements the polling loop that checks due monitors and
// persists the results to the shared PostgreSQL database; it is the sole polling
// engine (the API is REST-only).
package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/EliottV17/sentinel-worker/internal/checker"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Run(ctx context.Context, pool *pgxpool.Pool, concurrency int) {
	if concurrency <= 0 {
		concurrency = 10
	}
	sem := make(chan struct{}, concurrency)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

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

	_, err = pool.Exec(ctx, `
		INSERT INTO check_result (monitor_id, state, status_code, latency_ms, response_sample, error_message, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, m.ID, result.State, result.StatusCode, result.LatencyMs, result.ResponseSample, result.ErrorMessage, now)
	if err != nil {
		slog.Error("insert check_result error", "monitor_id", m.ID, "err", err)
		return
	}

	slog.Info("check completed",
		"monitor_id", m.ID,
		"target", m.Target,
		"state", result.State,
		"status_code", result.StatusCode,
		"latency_ms", result.LatencyMs,)

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

		_, err = pool.Exec(ctx, `
			INSERT INTO alert (monitor_id, alert_type, message, created_at)
			VALUES ($1, $2, $3, $4)
		`, m.ID, alertType, message, now)
		if err != nil {
			slog.Error("insert alert error", "monitor_id", m.ID, "err", err)
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
