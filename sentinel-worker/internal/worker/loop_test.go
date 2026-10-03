package worker

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/EliottV17/sentinel-worker/internal/checker"
	"github.com/jackc/pgx/v5/pgconn"
)

type insertFakeExecer struct {
	err   error
	block bool
}

func (f insertFakeExecer) Exec(ctx context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	if f.block {
		<-ctx.Done()
		return pgconn.CommandTag{}, ctx.Err()
	}
	return pgconn.CommandTag{}, f.err
}

type fakeMonitorRows struct {
	ctx            context.Context
	closeWhileLive bool
	errCheckedLive bool
}

func (r *fakeMonitorRows) Next() bool        { return false }
func (r *fakeMonitorRows) Scan(...any) error { return nil }
func (r *fakeMonitorRows) Err() error {
	r.errCheckedLive = r.ctx.Err() == nil
	return nil
}
func (r *fakeMonitorRows) Close() { r.closeWhileLive = r.ctx.Err() == nil }

type fakeMonitorQueryer struct {
	rows  *fakeMonitorRows
	block bool
}

func (q fakeMonitorQueryer) Query(ctx context.Context, _ string, _ ...any) (monitorRows, error) {
	if q.block {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	q.rows.ctx = ctx
	return q.rows, nil
}

type successfulChecker struct{}

func (successfulChecker) Check(context.Context, checker.Monitor) (checker.Result, error) {
	return checker.Result{State: "healthy"}, nil
}

func TestInsertResultOutcome(t *testing.T) {
	for _, tt := range []struct {
		name string
		err  error
		want insertOutcome
	}{{"deleted monitor", &pgconn.PgError{Code: "23503"}, insertMonitorDeleted}, {"other database error", errors.New("database unavailable"), insertFailed}, {"success", nil, insertSucceeded}} {
		t.Run(tt.name, func(t *testing.T) {
			got := insertResult(context.Background(), insertFakeExecer{err: tt.err}, "INSERT check_result", nil)
			if got.outcome != tt.want {
				t.Fatalf("outcome=%v want=%v", got.outcome, tt.want)
			}
			if tt.want == insertFailed && !errors.Is(got.err, tt.err) {
				t.Fatalf("error=%v want %v", got.err, tt.err)
			}
		})
	}
}

func TestInsertAlertOutcome(t *testing.T) {
	for _, tt := range []struct {
		name string
		err  error
		want insertOutcome
	}{{"deleted monitor", &pgconn.PgError{Code: "23503"}, insertMonitorDeleted}, {"other database error", errors.New("database unavailable"), insertFailed}, {"success", nil, insertSucceeded}} {
		t.Run(tt.name, func(t *testing.T) {
			got := insertAlert(context.Background(), insertFakeExecer{err: tt.err}, "INSERT alert", nil)
			if got.outcome != tt.want {
				t.Fatalf("outcome=%v want=%v", got.outcome, tt.want)
			}
			if tt.want == insertFailed && !errors.Is(got.err, tt.err) {
				t.Fatalf("error=%v want %v", got.err, tt.err)
			}
		})
	}
}

func TestFetchDueMonitorsCancelsSlowDatabaseQueryAndWithholdsHeartbeat(t *testing.T) {
	started := time.Now()
	beats := 0
	err := runPollCycle(context.Background(), 1, func(ctx context.Context) ([]checker.Monitor, error) {
		return fetchDueMonitors(ctx, fakeMonitorQueryer{block: true}, 20*time.Millisecond)
	}, func(context.Context, checker.Monitor) error { return nil }, func() { beats++ })
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > time.Second || beats != 0 {
		t.Fatalf("slow fetch error=%v elapsed=%s heartbeat=%d, want timeout and no heartbeat", err, time.Since(started), beats)
	}
}

func TestFetchDueMonitorsClosesRowsBeforeCancelingContext(t *testing.T) {
	rows := &fakeMonitorRows{}
	if _, err := fetchDueMonitors(context.Background(), fakeMonitorQueryer{rows: rows}, time.Second); err != nil {
		t.Fatal(err)
	}
	if !rows.errCheckedLive || !rows.closeWhileLive || rows.ctx.Err() == nil {
		t.Fatalf("row lifecycle: Err checked live=%v, Close live=%v, context canceled=%v", rows.errCheckedLive, rows.closeWhileLive, rows.ctx.Err() != nil)
	}
}

func TestCheckAndPersistActualInsertDeadlineWithholdsHeartbeat(t *testing.T) {
	checker.Register("deadline-test", successfulChecker{})
	monitor := checker.Monitor{ID: 101, Name: "slow insert", CheckType: "deadline-test"}
	execer := insertFakeExecer{block: true}
	beats := 0
	err := runPollCycle(context.Background(), 1, func(context.Context) ([]checker.Monitor, error) {
		return []checker.Monitor{monitor}, nil
	}, func(ctx context.Context, monitor checker.Monitor) error {
		return checkAndPersist(ctx, execer, monitor, 20*time.Millisecond)
	}, func() { beats++ })
	if !errors.Is(err, context.DeadlineExceeded) || beats != 0 {
		t.Fatalf("poll cycle err=%v heartbeat count=%d; expected actual insert timeout and no heartbeat", err, beats)
	}
}

func TestUnsupportedCheckerIsLocalAndDoesNotSuppressValidProgress(t *testing.T) {
	checker.Register("valid-progress-checker", successfulChecker{})
	monitors := []checker.Monitor{
		{ID: 1, CheckType: "unsupported-checker"},
		{ID: 2, Name: "valid", CheckType: "valid-progress-checker"},
	}
	beats := 0
	err := runPollCycle(context.Background(), 2, func(context.Context) ([]checker.Monitor, error) {
		return monitors, nil
	}, func(ctx context.Context, monitor checker.Monitor) error {
		return checkAndPersist(ctx, insertFakeExecer{}, monitor, time.Second)
	}, func() { beats++ })
	if err != nil || beats != 2 {
		t.Fatalf("cycle err=%v heartbeat milestones=%d; unsupported checker starved progress", err, beats)
	}
}

func TestExpectedConcurrentDeleteFK(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "foreign key", err: &pgconn.PgError{Code: "23503"}, want: true},
		{name: "other database error", err: errors.New("database unavailable")},
		{name: "nil", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isConcurrentDeleteForeignKey(tt.err); got != tt.want {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}
