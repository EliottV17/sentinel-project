// Package config loads worker configuration from the environment.
package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	DatabaseURL        string
	Concurrency        int
	AllowedPorts       string
	DemoUserEmail      string
	DemoManifestPath   string
	DemoResetInterval  int
	DBOperationTimeout time.Duration
	HealthDBTimeout    time.Duration
	HeartbeatPath      string
	HeartbeatMaxAge    time.Duration
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

func Load() Config {
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
	return Config{
		DatabaseURL:        url,
		Concurrency:        concurrency,
		AllowedPorts:       allowedPorts,
		DemoUserEmail:      os.Getenv("DEMO_USER_EMAIL"),
		DemoManifestPath:   os.Getenv("DEMO_MONITORS_MANIFEST_PATH"),
		DemoResetInterval:  demoResetInterval,
		DBOperationTimeout: dbTimeout,
		HealthDBTimeout:    durationEnv("WORKER_HEALTH_DB_TIMEOUT_SECONDS", 5),
		HeartbeatPath:      stringEnv("WORKER_HEARTBEAT_PATH", "/tmp/sentinel-worker.heartbeat"),
		HeartbeatMaxAge:    heartbeatMaxAge,
	}
}
