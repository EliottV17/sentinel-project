package config

import (
	"testing"
	"time"
)

func TestWorkerDeadlineAndHeartbeatConfig(t *testing.T) {
	for _, key := range []string{"WORKER_DB_TIMEOUT_SECONDS", "WORKER_HEALTH_DB_TIMEOUT_SECONDS", "WORKER_HEARTBEAT_PATH", "WORKER_HEARTBEAT_MAX_AGE_SECONDS"} {
		t.Setenv(key, "")
	}
	defaults := Load()
	if defaults.DBOperationTimeout != 10*time.Second || defaults.HealthDBTimeout != 5*time.Second || defaults.HeartbeatPath != "/tmp/sentinel-worker.heartbeat" || defaults.HeartbeatMaxAge != 67*time.Second {
		t.Fatalf("unexpected defaults: %#v", defaults)
	}
	t.Setenv("WORKER_DB_TIMEOUT_SECONDS", "7")
	t.Setenv("WORKER_HEALTH_DB_TIMEOUT_SECONDS", "3")
	t.Setenv("WORKER_HEARTBEAT_PATH", "/var/run/sentinel/worker.heartbeat")
	t.Setenv("WORKER_HEARTBEAT_MAX_AGE_SECONDS", "21")
	got := Load()
	if got.DBOperationTimeout != 7*time.Second || got.HealthDBTimeout != 3*time.Second || got.HeartbeatPath != "/var/run/sentinel/worker.heartbeat" || got.HeartbeatMaxAge != 55*time.Second {
		t.Fatalf("worker config not loaded: %#v", got)
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
		got := Load()
		if got.DemoUserEmail != "demo@example.test" || got.DemoManifestPath != "/data/monitors.json" {
			t.Fatalf("demo env not loaded: %#v", got)
		}
		if got.DemoResetInterval != tt.want {
			t.Fatalf("interval=%d want=%d", got.DemoResetInterval, tt.want)
		}
	}
}
