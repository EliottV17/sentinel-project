// Package worker implements the polling loop that checks due monitors and
// persists the results alongside the API scheduler.
package worker

import (
	"context"
	"log"
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
				log.Printf("fetchDueMonitors error: %v", err)
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
		log.Printf("unknown checker type %q for monitor %d", m.CheckType, m.ID)
		return
	}

	result, err := c.Check(ctx, m)
	if err != nil {
		log.Printf("check error for monitor %d: %v", m.ID, err)
		return
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO check_result (monitor_id, state, status_code, latency_ms, response_sample, error_message)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, m.ID, result.State, result.StatusCode, result.LatencyMs, result.ResponseSample, result.ErrorMessage)
	if err != nil {
		log.Printf("insert check_result error for monitor %d: %v", m.ID, err)
		return
	}

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
		SET last_state = $1, last_checked_at = NOW(), consecutive_failures = $2
		WHERE id = $3
	`, newState, consecutiveFailures, m.ID)
	if err != nil {
		log.Printf("update monitor error for %d: %v", m.ID, err)
	}

	if oldState != nil && *oldState != newState {
		alertType := "down"
		message := m.Name + " esta caído"
		if newState == "healthy" {
			alertType = "recovery"
			message = m.Name + " se recuperó"
		}

		_, err = pool.Exec(ctx, `
			INSERT INTO alert (monitor_id, alert_type, message)
			VALUES ($1, $2, $3)
		`, m.ID, alertType, message)
		if err != nil {
			log.Printf("insert alert error for monitor %d: %v", m.ID, err)
		}
	}
}