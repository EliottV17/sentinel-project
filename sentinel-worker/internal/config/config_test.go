package config

import "testing"

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
