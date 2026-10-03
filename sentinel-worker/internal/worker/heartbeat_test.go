package worker

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/EliottV17/sentinel-worker/internal/health"
)

func TestPollCycleAdvancesHeartbeatOnlyAfterSuccessfulProgress(t *testing.T) {
	for _, tt := range []struct {
		name      string
		fetchErr  error
		workErr   error
		monitors  []int
		blockWork bool
		wantBeat  bool
	}{
		{name: "healthy empty cycle", wantBeat: true},
		{name: "fetch failed", fetchErr: errors.New("database unavailable")},
		{name: "persistence failed", monitors: []int{1}, workErr: errors.New("database unavailable")},
		{name: "dispatch blocked", monitors: []int{1}, blockWork: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			beats := 0
			work := func(ctx context.Context, _ int) error {
				if tt.blockWork {
					<-ctx.Done()
					return ctx.Err()
				}
				return tt.workErr
			}
			ctx, cancel := context.WithCancel(context.Background())
			fetch := func(context.Context) ([]int, error) { return tt.monitors, tt.fetchErr }
			var err error
			if tt.blockWork {
				started := make(chan struct{})
				work = func(ctx context.Context, _ int) error {
					close(started)
					<-ctx.Done()
					return ctx.Err()
				}
				done := make(chan error, 1)
				go func() { done <- runPollCycle(ctx, 1, fetch, work, func() { beats++ }) }()
				<-started
				cancel()
				err = <-done
			} else {
				if tt.fetchErr != nil {
					cancel()
				}
				err = runPollCycle(ctx, 1, fetch, work, func() { beats++ })
				cancel()
			}
			if tt.wantBeat && (err != nil || beats != 1) {
				t.Fatalf("cycle err=%v beats=%d, want healthy heartbeat", err, beats)
			}
			if !tt.wantBeat && beats != 0 {
				t.Fatalf("heartbeat advanced %d times on incomplete cycle", beats)
			}
		})
	}
}

func TestPollCycleHeartbeatMilestonesContinueAcrossDeepBatch(t *testing.T) {
	var active atomic.Int32
	var maxActive atomic.Int32
	beats := 0
	err := runPollCycle(context.Background(), 2, func(context.Context) ([]int, error) {
		return []int{1, 2, 3, 4, 5}, nil
	}, func(context.Context, int) error {
		current := active.Add(1)
		for previous := maxActive.Load(); current > previous && !maxActive.CompareAndSwap(previous, current); previous = maxActive.Load() {
		}
		active.Add(-1)
		return nil
	}, func() { beats++ })
	if err != nil || beats != 5 {
		t.Fatalf("cycle err=%v heartbeat milestones=%d, want five completions", err, beats)
	}
	if maxActive.Load() > 2 {
		t.Fatalf("active workers=%d, exceeded configured concurrency 2", maxActive.Load())
	}
}

func TestPollCycleSingleLongCheckRemainsFreshUntilCompletion(t *testing.T) {
	path := t.TempDir() + "/heartbeat"
	startedAt := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	if err := health.WriteHeartbeat(path, startedAt); err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	started := make(chan struct{})
	beats := 0
	var simulatedNow = startedAt.Add(66 * time.Second)
	done := make(chan error, 1)
	go func() {
		done <- runPollCycle(context.Background(), 1, func(context.Context) ([]int, error) { return []int{1}, nil }, func(context.Context, int) error {
			close(started)
			<-release
			return nil
		}, func() {
			beats++
			simulatedNow = simulatedNow.Add(time.Second)
			if err := health.WriteHeartbeat(path, simulatedNow); err != nil {
				t.Errorf("write simulated heartbeat: %v", err)
			}
		})
	}()
	<-started
	if err := health.CheckHeartbeat(path, simulatedNow, 67*time.Second); err != nil {
		t.Fatalf("single allowed long check became stale before its completion budget: %v", err)
	}
	if beats != 0 {
		t.Fatalf("heartbeat advanced while check was blocked: %d", beats)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if beats != 1 {
		t.Fatalf("completion heartbeat count=%d, want 1", beats)
	}
}

func TestPollCycleTotalStallBecomesStaleWithoutMilestone(t *testing.T) {
	path := t.TempDir() + "/heartbeat"
	lastBeat := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	if err := health.WriteHeartbeat(path, lastBeat); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	beats := 0
	done := make(chan error, 1)
	go func() {
		done <- runPollCycle(ctx, 1, func(context.Context) ([]int, error) { return []int{1}, nil }, func(ctx context.Context, _ int) error {
			close(started)
			<-ctx.Done()
			return ctx.Err()
		}, func() { beats++ })
	}()
	<-started
	if err := health.CheckHeartbeat(path, lastBeat.Add(68*time.Second), 67*time.Second); err == nil {
		t.Fatal("stalled work still considered fresh")
	}
	if beats != 0 {
		t.Fatalf("heartbeat advanced without a completion milestone: %d", beats)
	}
	cancel()
	<-done
}

func TestPollCycleUnsupportedMonitorDoesNotStarveHealth(t *testing.T) {
	beats := 0
	err := runPollCycle(context.Background(), 1, func(context.Context) ([]int, error) {
		return []int{1, 2}, nil
	}, func(_ context.Context, id int) error {
		if id == 1 {
			return monitorCheckError{err: errors.New("unknown checker type")}
		}
		return nil
	}, func() { beats++ })
	if err != nil || beats != 2 {
		t.Fatalf("cycle err=%v heartbeats=%d, unsupported monitor starved progress", err, beats)
	}
}

func TestPollCycleShutdownWhileWaitingForCapacity(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- runPollCycle(ctx, 1, func(context.Context) ([]int, error) { return []int{1, 2}, nil }, func(ctx context.Context, id int) error {
			if id == 1 {
				close(started)
				<-ctx.Done()
				return ctx.Err()
			}
			return nil
		}, func() {})
	}()
	<-started
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("poll cycle hung while cancellation waited for a worker permit")
	}
}
