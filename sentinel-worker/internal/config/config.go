// Package config loads worker configuration from the environment.
package config

import (
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL       string
	Concurrency       int
	AllowedPorts      string
	DemoUserEmail     string
	DemoManifestPath  string
	DemoResetInterval int
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
	return Config{
		DatabaseURL:       url,
		Concurrency:       concurrency,
		AllowedPorts:      allowedPorts,
		DemoUserEmail:     os.Getenv("DEMO_USER_EMAIL"),
		DemoManifestPath:  os.Getenv("DEMO_MONITORS_MANIFEST_PATH"),
		DemoResetInterval: demoResetInterval,
	}
}
