// Package health implements heartbeat freshness and database checks for the worker binary.
package health

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Pinger interface {
	Ping(context.Context) error
}

// WriteHeartbeat atomically publishes the timestamp of a completed poll cycle.
func WriteHeartbeat(path string, now time.Time) error {
	return writeHeartbeat(path, now.UTC().Format(time.RFC3339Nano))
}

// ResetHeartbeat invalidates a previous process's heartbeat before startup.
func ResetHeartbeat(path string) error { return writeHeartbeat(path, "") }

func writeHeartbeat(path, value string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("create heartbeat directory: %w", err)
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".heartbeat-*")
	if err != nil {
		return fmt.Errorf("create heartbeat temp file: %w", err)
	}
	tempPath := file.Name()
	defer os.Remove(tempPath)
	if err := file.Chmod(0600); err != nil {
		file.Close()
		return fmt.Errorf("set heartbeat permissions: %w", err)
	}
	if _, err := file.WriteString(value); err != nil {
		file.Close()
		return fmt.Errorf("write heartbeat: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return fmt.Errorf("sync heartbeat: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close heartbeat: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("publish heartbeat: %w", err)
	}
	return nil
}

func CheckHeartbeat(path string, now time.Time, maxAge time.Duration) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read worker heartbeat: %w", err)
	}
	stamp, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(string(data)))
	if err != nil {
		return fmt.Errorf("worker heartbeat is missing or malformed: %w", err)
	}
	age := now.Sub(stamp)
	if age < 0 {
		return fmt.Errorf("worker heartbeat is in the future")
	}
	if age > maxAge {
		return fmt.Errorf("worker heartbeat is stale: age %s exceeds %s", age.Round(time.Millisecond), maxAge)
	}
	return nil
}

func Check(ctx context.Context, path string, maxAge, dbTimeout time.Duration, db Pinger) error {
	if err := CheckHeartbeat(path, time.Now().UTC(), maxAge); err != nil {
		return err
	}
	pingCtx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	if err := db.Ping(pingCtx); err != nil {
		return fmt.Errorf("worker database ping failed: %w", err)
	}
	return nil
}
