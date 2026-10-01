// Package config loads worker configuration from the environment.
package config

import "os"

type Config struct {
	DatabaseURL  string
	Concurrency  int
	AllowedPorts string
}

func Load() Config {
	concurrency := 10
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@127.0.0.1:5432/sentinel_db"
	}
	allowedPorts := os.Getenv("ALLOWED_PORTS")
	return Config{
		DatabaseURL:  url,
		Concurrency:  concurrency,
		AllowedPorts: allowedPorts,
	}
}
