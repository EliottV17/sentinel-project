package health

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type pingFunc func(context.Context) error

func (f pingFunc) Ping(ctx context.Context) error { return f(ctx) }

func TestHeartbeatAtomicWriteAndFreshness(t *testing.T) {
	path := filepath.Join(t.TempDir(), "worker.heartbeat")
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	if err := WriteHeartbeat(path, now); err != nil {
		t.Fatal(err)
	}
	if err := CheckHeartbeat(path, now.Add(time.Second), time.Minute); err != nil {
		t.Fatalf("fresh heartbeat rejected: %v", err)
	}
	if err := CheckHeartbeat(path, now.Add(2*time.Minute), time.Minute); err == nil {
		t.Fatal("stale heartbeat accepted")
	}
	if err := CheckHeartbeat(path, now.Add(-time.Second), time.Minute); err == nil {
		t.Fatal("future heartbeat accepted")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		t.Fatalf("heartbeat file missing or empty: %v", err)
	}
	if err := ResetHeartbeat(path); err != nil {
		t.Fatal(err)
	}
	if err := CheckHeartbeat(path, now, time.Minute); err == nil {
		t.Fatal("prior process heartbeat remained healthy after startup invalidation")
	}
}

func TestCheckRejectsMissingMalformedAndStaleHeartbeat(t *testing.T) {
	for _, tt := range []struct {
		name string
		data *string
	}{
		{name: "missing"},
		{name: "malformed", data: stringPointer("not-a-time")},
		{name: "stale", data: stringPointer("2020-01-01T00:00:00Z")},
	} {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "heartbeat")
			if tt.data != nil {
				if err := os.WriteFile(path, []byte(*tt.data), 0600); err != nil {
					t.Fatal(err)
				}
			}
			err := Check(context.Background(), path, time.Minute, time.Second, pingFunc(func(context.Context) error { return nil }))
			if err == nil {
				t.Fatal("invalid heartbeat accepted")
			}
		})
	}
}

func TestCheckBoundsAndReportsDatabasePing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "heartbeat")
	if err := WriteHeartbeat(path, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	err := Check(context.Background(), path, time.Minute, 20*time.Millisecond, pingFunc(func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}))
	if err == nil || time.Since(started) > time.Second {
		t.Fatalf("slow ping result=%v elapsed=%s", err, time.Since(started))
	}
	wantErr := errors.New("database unavailable")
	err = Check(context.Background(), path, time.Minute, time.Second, pingFunc(func(context.Context) error { return wantErr }))
	if !errors.Is(err, wantErr) {
		t.Fatalf("got %v, want wrapped database error", err)
	}
}

func stringPointer(s string) *string { return &s }
