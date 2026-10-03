// Package config loads worker configuration from the environment.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	DatabaseURL              string
	Concurrency              int
	AllowedPorts             string
	DemoUserEmail            string
	DemoManifestPath         string
	DemoResetInterval        int
	DBOperationTimeout       time.Duration
	HealthDBTimeout          time.Duration
	HeartbeatPath            string
	HeartbeatMaxAge          time.Duration
	CheckResultRetentionDays int
	AlertRetentionDays       int
	StatusUptimeWindowHours  int
	RetentionIntervalMinutes int
	RetentionBatchSize       int
	RetentionDBTimeout       time.Duration
}

func stringEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

const maxDurationSeconds = int64((1<<63 - 1) / int64(time.Second))

func durationEnv(key string, fallbackSeconds int) time.Duration {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.ParseInt(value, 10, 64); err == nil && parsed > 0 && parsed <= maxDurationSeconds {
			return time.Duration(parsed) * time.Second
		}
	}
	return time.Duration(fallbackSeconds) * time.Second
}

const (
	maxRetentionDays             = 36500
	maxUptimeHours               = 876000
	maxRetentionIntervalMinutes  = 1440
	maxRetentionBatchSize        = 5000
	maxRetentionDBTimeoutSeconds = 3600
)

func boundedPositiveEnv(key string, fallback, maximum int) (int, error) {
	value, exists := os.LookupEnv(key)
	if !exists {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 || parsed > maximum {
		return 0, fmt.Errorf("%s must be an integer between 1 and %d", key, maximum)
	}
	return parsed, nil
}

func Load() (Config, error) {
	concurrency := 10
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@127.0.0.1:5432/sentinel_db"
	}
	allowedPorts := os.Getenv("ALLOWED_PORTS")
	demoResetInterval := 60
	if value := os.Getenv("DEMO_RESET_INTERVAL_MINUTES"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			demoResetInterval = parsed
		}
	}
	dbTimeout := durationEnv("WORKER_DB_TIMEOUT_SECONDS", 10)
	// Keep the derived sum representable even for extreme environment values.
	maxDBTimeout := (time.Duration(1<<63-1) - 27*time.Second) / 4
	if dbTimeout > maxDBTimeout {
		dbTimeout = maxDBTimeout
	}
	// Allow fetch (one DB deadline), the capped 15s probe, three sequential
	// persistence deadlines, the 2s poll interval, and a 10s scheduling margin.
	minimumHeartbeatAge := dbTimeout*4 + 15*time.Second + 2*time.Second + 10*time.Second
	heartbeatMaxAge := durationEnv("WORKER_HEARTBEAT_MAX_AGE_SECONDS", int(minimumHeartbeatAge/time.Second))
	if heartbeatMaxAge < minimumHeartbeatAge {
		heartbeatMaxAge = minimumHeartbeatAge
	}
	checkDays, err := boundedPositiveEnv("CHECK_RESULT_RETENTION_DAYS", 30, maxRetentionDays)
	if err != nil {
		return Config{}, err
	}
	alertDays, err := boundedPositiveEnv("ALERT_RETENTION_DAYS", 90, maxRetentionDays)
	if err != nil {
		return Config{}, err
	}
	uptimeHours, err := boundedPositiveEnv("STATUS_UPTIME_WINDOW_HOURS", 24, maxUptimeHours)
	if err != nil {
		return Config{}, err
	}
	if checkDays*24 < uptimeHours {
		return Config{}, fmt.Errorf("CHECK_RESULT_RETENTION_DAYS (%d) must be at least STATUS_UPTIME_WINDOW_HOURS (%d hours)", checkDays, uptimeHours)
	}
	retentionInterval, err := boundedPositiveEnv("RETENTION_INTERVAL_MINUTES", 60, maxRetentionIntervalMinutes)
	if err != nil {
		return Config{}, err
	}
	batchSize, err := boundedPositiveEnv("RETENTION_BATCH_SIZE", 500, maxRetentionBatchSize)
	if err != nil {
		return Config{}, err
	}
	retentionTimeout, err := boundedPositiveEnv("RETENTION_DB_TIMEOUT_SECONDS", 5, maxRetentionDBTimeoutSeconds)
	if err != nil {
		return Config{}, err
	}
	return Config{
		DatabaseURL:              url,
		Concurrency:              concurrency,
		AllowedPorts:             allowedPorts,
		DemoUserEmail:            os.Getenv("DEMO_USER_EMAIL"),
		DemoManifestPath:         os.Getenv("DEMO_MONITORS_MANIFEST_PATH"),
		DemoResetInterval:        demoResetInterval,
		DBOperationTimeout:       dbTimeout,
		HealthDBTimeout:          durationEnv("WORKER_HEALTH_DB_TIMEOUT_SECONDS", 5),
		HeartbeatPath:            stringEnv("WORKER_HEARTBEAT_PATH", "/tmp/sentinel-worker.heartbeat"),
		HeartbeatMaxAge:          heartbeatMaxAge,
		CheckResultRetentionDays: checkDays,
		AlertRetentionDays:       alertDays,
		StatusUptimeWindowHours:  uptimeHours,
		RetentionIntervalMinutes: retentionInterval,
		RetentionBatchSize:       batchSize,
		RetentionDBTimeout:       time.Duration(retentionTimeout) * time.Second,
	}, nil
}
