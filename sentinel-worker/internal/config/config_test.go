package config

import (
	"os"
	"testing"
	"time"
)

func unsetEnv(t *testing.T, key string) {
	t.Helper()
	previous, existed := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if existed {
			_ = os.Setenv(key, previous)
		} else {
			_ = os.Unsetenv(key)
		}
	})
}

func TestWorkerDeadlineAndHeartbeatConfig(t *testing.T) {
	for _, key := range []string{"WORKER_DB_TIMEOUT_SECONDS", "WORKER_HEALTH_DB_TIMEOUT_SECONDS", "WORKER_HEARTBEAT_PATH", "WORKER_HEARTBEAT_MAX_AGE_SECONDS", "CHECK_RESULT_RETENTION_DAYS", "ALERT_RETENTION_DAYS", "STATUS_UPTIME_WINDOW_HOURS", "RETENTION_INTERVAL_MINUTES", "RETENTION_BATCH_SIZE", "RETENTION_DB_TIMEOUT_SECONDS"} {
		unsetEnv(t, key)
	}
	defaults, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if defaults.DBOperationTimeout != 10*time.Second || defaults.HealthDBTimeout != 5*time.Second || defaults.HeartbeatPath != "/tmp/sentinel-worker.heartbeat" || defaults.HeartbeatMaxAge != 67*time.Second {
		t.Fatalf("unexpected defaults: %#v", defaults)
	}
	t.Setenv("WORKER_DB_TIMEOUT_SECONDS", "7")
	t.Setenv("WORKER_HEALTH_DB_TIMEOUT_SECONDS", "3")
	t.Setenv("WORKER_HEARTBEAT_PATH", "/var/run/sentinel/worker.heartbeat")
	t.Setenv("WORKER_HEARTBEAT_MAX_AGE_SECONDS", "21")
	got, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.DBOperationTimeout != 7*time.Second || got.HealthDBTimeout != 3*time.Second || got.HeartbeatPath != "/var/run/sentinel/worker.heartbeat" || got.HeartbeatMaxAge != 55*time.Second {
		t.Fatalf("worker config not loaded: %#v", got)
	}
}

func TestRetentionConfigDefaultsAndValidation(t *testing.T) {
	for _, key := range []string{"CHECK_RESULT_RETENTION_DAYS", "ALERT_RETENTION_DAYS", "STATUS_UPTIME_WINDOW_HOURS", "RETENTION_INTERVAL_MINUTES", "RETENTION_BATCH_SIZE", "RETENTION_DB_TIMEOUT_SECONDS"} {
		unsetEnv(t, key)
	}
	got, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.CheckResultRetentionDays != 30 || got.AlertRetentionDays != 90 || got.StatusUptimeWindowHours != 24 || got.RetentionIntervalMinutes != 60 || got.RetentionBatchSize != 500 || got.RetentionDBTimeout != 5*time.Second {
		t.Fatalf("unexpected retention defaults: %#v", got)
	}
	for _, tt := range []struct {
		name, checks, alerts, uptime string
		wantErr                      bool
	}{
		{name: "equal uptime boundary accepted", checks: "1", alerts: "2", uptime: "24"},
		{name: "checks below uptime rejected", checks: "1", alerts: "2", uptime: "25", wantErr: true},
		{name: "malformed rejected", checks: "30x", alerts: "90", uptime: "24", wantErr: true},
		{name: "empty explicitly rejected", checks: "", alerts: "90", uptime: "24", wantErr: true},
		{name: "zero rejected", checks: "0", alerts: "90", uptime: "24", wantErr: true},
		{name: "bounded days rejected", checks: "36501", alerts: "90", uptime: "24", wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("CHECK_RESULT_RETENTION_DAYS", tt.checks)
			t.Setenv("ALERT_RETENTION_DAYS", tt.alerts)
			t.Setenv("STATUS_UPTIME_WINDOW_HOURS", tt.uptime)
			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Load() error=%v wantErr=%v", err, tt.wantErr)
			}
		})
	}
}

func TestRetentionConfigurationRejectsInvalidBounds(t *testing.T) {
	for _, tt := range []struct{ name, key, value string }{
		{name: "alert days malformed", key: "ALERT_RETENTION_DAYS", value: "many"},
		{name: "uptime hours too large", key: "STATUS_UPTIME_WINDOW_HOURS", value: "876001"},
		{name: "interval zero", key: "RETENTION_INTERVAL_MINUTES", value: "0"},
		{name: "batch too large", key: "RETENTION_BATCH_SIZE", value: "5001"},
		{name: "database timeout too large", key: "RETENTION_DB_TIMEOUT_SECONDS", value: "3601"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			unsetEnv(t, "CHECK_RESULT_RETENTION_DAYS")
			unsetEnv(t, "ALERT_RETENTION_DAYS")
			unsetEnv(t, "STATUS_UPTIME_WINDOW_HOURS")
			unsetEnv(t, "RETENTION_INTERVAL_MINUTES")
			unsetEnv(t, "RETENTION_BATCH_SIZE")
			unsetEnv(t, "RETENTION_DB_TIMEOUT_SECONDS")
			t.Setenv(tt.key, tt.value)
			if _, err := Load(); err == nil {
				t.Fatalf("Load() accepted %s=%q", tt.key, tt.value)
			}
		})
	}
}

func TestDemoConfigFromEnvironment(t *testing.T) {
	t.Setenv("DEMO_USER_EMAIL", "demo@example.test")
	t.Setenv("DEMO_MONITORS_MANIFEST_PATH", "/data/monitors.json")
	for _, tt := range []struct {
		value string
		want  int
	}{{"", 60}, {"13", 13}} {
		t.Setenv("DEMO_RESET_INTERVAL_MINUTES", tt.value)
		got, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if got.DemoUserEmail != "demo@example.test" || got.DemoManifestPath != "/data/monitors.json" {
			t.Fatalf("demo env not loaded: %#v", got)
		}
		if got.DemoResetInterval != tt.want {
			t.Fatalf("interval=%d want=%d", got.DemoResetInterval, tt.want)
		}
	}
}
