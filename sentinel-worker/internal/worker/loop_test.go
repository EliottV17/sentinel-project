package worker

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/EliottV17/sentinel-worker/internal/checker"
	"github.com/jackc/pgx/v5/pgconn"
)

type insertFakeExecer struct {
	err   error
	block bool
}

func (f insertFakeExecer) Begin(context.Context) (persistenceTx, error) { return f, nil }
func (f insertFakeExecer) Commit(context.Context) error                 { return nil }
func (f insertFakeExecer) Rollback(context.Context) error               { return nil }
func (f insertFakeExecer) Exec(ctx context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	if f.block {
		<-ctx.Done()
		return pgconn.CommandTag{}, ctx.Err()
	}
	return pgconn.NewCommandTag("UPDATE 1"), f.err
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

func TestEvaluateFSMThresholdTransitions(t *testing.T) {
	healthy, unhealthy := "healthy", "unhealthy"
	for _, tt := range []struct {
		name      string
		old       *string
		prev      int
		probe     string
		threshold int
		state     *string
		failures  int
		alert     string
	}{
		{"initial first failure", nil, 0, "unhealthy", 3, nil, 1, ""},
		{"initial third failure", nil, 2, "unhealthy", 3, &unhealthy, 3, "down"},
		{"initial recovery from transient", nil, 2, "healthy", 3, &healthy, 0, ""},
		{"healthy transient failure", &healthy, 1, "unhealthy", 3, &healthy, 2, ""},
		{"healthy reaches threshold", &healthy, 2, "unhealthy", 3, &unhealthy, 3, "down"},
		{"healthy probe resets failures", &healthy, 2, "healthy", 3, &healthy, 0, ""},
		{"confirmed outage persists", &unhealthy, 3, "unhealthy", 3, &unhealthy, 4, ""},
		{"recovery emits alert", &unhealthy, 3, "healthy", 3, &healthy, 0, "recovery"},
		{"custom threshold", nil, 1, "unhealthy", 2, &unhealthy, 2, "down"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := evaluateFSM(tt.old, tt.prev, tt.probe, tt.threshold)
			if !sameState(got.state, tt.state) || got.consecutiveFailures != tt.failures || got.alertType != tt.alert {
				t.Fatalf("evaluateFSM() = %#v, want state=%v failures=%d alert=%q", got, tt.state, tt.failures, tt.alert)
			}
		})
	}
}

func sameState(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

type recordingChecker struct {
	result checker.Result
	err    error
	events *[]string
}

func (c recordingChecker) Check(context.Context, checker.Monitor) (checker.Result, error) {
	*c.events = append(*c.events, "probe")
	return c.result, c.err
}

type recordingPersistenceDB struct {
	events   *[]string
	beginErr error
	tx       *recordingPersistenceTx
}

func (d *recordingPersistenceDB) Begin(context.Context) (persistenceTx, error) {
	*d.events = append(*d.events, "begin")
	if d.beginErr != nil {
		return nil, d.beginErr
	}
	return d.tx, nil
}

type recordingPersistenceTx struct {
	events              *[]string
	errors              map[string]error
	zeroUpdate          bool
	committed           bool
	rolledBack          bool
	cancelParent        context.CancelFunc
	rollbackContextLive bool
	queries             []string
	args                [][]any
}

func (tx *recordingPersistenceTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	step := ""
	switch {
	case strings.Contains(query, "INSERT INTO check_result"):
		step = "check_result"
	case strings.Contains(query, "UPDATE monitor"):
		step = "monitor"
	case strings.Contains(query, "INSERT INTO alert"):
		step = "alert"
	}
	*tx.events = append(*tx.events, step)
	tx.queries = append(tx.queries, query)
	tx.args = append(tx.args, append([]any(nil), args...))
	if err := tx.errors[step]; err != nil {
		return pgconn.CommandTag{}, err
	}
	if step == "monitor" && tx.zeroUpdate {
		return pgconn.NewCommandTag("UPDATE 0"), nil
	}
	if step == "monitor" {
		return pgconn.NewCommandTag("UPDATE 1"), nil
	}
	return pgconn.NewCommandTag("INSERT 1"), nil
}
func (tx *recordingPersistenceTx) Commit(context.Context) error {
	*tx.events = append(*tx.events, "commit")
	if tx.cancelParent != nil {
		tx.cancelParent()
	}
	err := tx.errors["commit"]
	if err == nil {
		tx.committed = true
	}
	return err
}
func (tx *recordingPersistenceTx) Rollback(ctx context.Context) error {
	*tx.events = append(*tx.events, "rollback")
	tx.rolledBack = true
	tx.rollbackContextLive = ctx.Err() == nil
	return nil
}

func registerRecordingChecker(name string, events *[]string, result checker.Result, err error) {
	checker.Register(name, recordingChecker{result: result, err: err, events: events})
}
func newRecordingDB(events *[]string) *recordingPersistenceDB {
	return &recordingPersistenceDB{events: events, tx: &recordingPersistenceTx{events: events, errors: map[string]error{}}}
}
func runRecordedCheck(t *testing.T, monitor checker.Monitor, result checker.Result, probeErr error, db *recordingPersistenceDB, threshold int) error {
	t.Helper()
	name := "recording-" + t.Name()
	registerRecordingChecker(name, db.events, result, probeErr)
	monitor.CheckType = name
	return checkAndPersist(context.Background(), db, monitor, time.Second, threshold)
}
func assertSequence(t *testing.T, got, want []string) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("events=%v want=%v", got, want)
	}
}

func TestCheckAndPersistTransactionalSuccessMatrix(t *testing.T) {
	healthy, unhealthy := "healthy", "unhealthy"
	cases := []struct {
		name         string
		old          *string
		failures     int
		probe        string
		wantState    any
		wantFailures int
		wantAlert    string
		wantMessage  string
		wantExecs    int
	}{
		{"initial failure one", nil, 0, "unhealthy", nil, 1, "", "", 2},
		{"initial failure threshold", nil, 2, "unhealthy", "unhealthy", 3, "down", "api esta caído", 3},
		{"healthy failure two", &healthy, 1, "unhealthy", "healthy", 2, "", "", 2},
		{"healthy failure threshold", &healthy, 2, "unhealthy", "unhealthy", 3, "down", "api esta caído", 3},
		{"recovery", &unhealthy, 4, "healthy", "healthy", 0, "recovery", "api se recuperó", 3},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			events := []string{}
			db := newRecordingDB(&events)
			m := checker.Monitor{ID: 9, Name: "api", LastState: tt.old, ConsecutiveFailures: tt.failures}
			if err := runRecordedCheck(t, m, checker.Result{State: tt.probe}, nil, db, 3); err != nil {
				t.Fatal(err)
			}
			wantEvents := []string{"probe", "begin", "check_result", "monitor"}
			if tt.wantAlert != "" {
				wantEvents = append(wantEvents, "alert")
			}
			wantEvents = append(wantEvents, "commit", "rollback")
			assertSequence(t, events, wantEvents)
			if !db.tx.committed || db.tx.rolledBack == false {
				t.Fatalf("commit=%v deferred rollback=%v", db.tx.committed, db.tx.rolledBack)
			}
			if len(db.tx.args) != tt.wantExecs {
				t.Fatalf("exec count=%d want=%d", len(db.tx.args), tt.wantExecs)
			}
			if db.tx.args[0][1] != tt.probe {
				t.Fatalf("raw check result state=%v", db.tx.args[0][1])
			}
			stateArg := db.tx.args[1][0]
			if !reflect.DeepEqual(stateArg, tt.wantState) || db.tx.args[1][1] != tt.wantFailures {
				t.Fatalf("update state=%#v failures=%v", stateArg, db.tx.args[1][1])
			}
			if tt.wantAlert != "" && (db.tx.args[2][1] != tt.wantAlert || db.tx.args[2][2] != tt.wantMessage) {
				t.Fatalf("alert args=%v", db.tx.args[2])
			}
		})
	}
}

func TestCheckAndPersistProbeBeforeBeginAndProbeErrors(t *testing.T) {
	for _, tt := range []struct {
		name      string
		checkType string
		probeErr  error
		wantErr   bool
	}{
		{name: "checker lookup failure", checkType: "not-registered", wantErr: true},
		{name: "probe failure", probeErr: errors.New("probe unavailable"), wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			events := []string{}
			db := newRecordingDB(&events)
			m := checker.Monitor{CheckType: tt.checkType}
			if tt.probeErr != nil {
				registerRecordingChecker("recorded-probe-error", &events, checker.Result{}, tt.probeErr)
				m.CheckType = "recorded-probe-error"
			}
			err := checkAndPersist(context.Background(), db, m, time.Second)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err=%v", err)
			}
			if len(events) != 0 && !reflect.DeepEqual(events, []string{"probe"}) {
				t.Fatalf("events=%v", events)
			}
		})
	}
	events := []string{}
	db := newRecordingDB(&events)
	if err := runRecordedCheck(t, checker.Monitor{}, checker.Result{State: "healthy"}, nil, db, 3); err != nil {
		t.Fatal(err)
	}
	assertSequence(t, events, []string{"probe", "begin", "check_result", "monitor", "commit", "rollback"})
}

func TestCheckAndPersistRollbackAndConcurrentDeleteMatrix(t *testing.T) {
	for _, tt := range []struct {
		name, failAt string
		dbBegin      error
		failure      error
		zero         bool
		wantNil      bool
		wantEvents   []string
	}{
		{name: "begin error", failAt: "begin", dbBegin: errors.New("begin failed"), wantEvents: []string{"probe", "begin"}},
		{name: "check result error", failAt: "check_result", failure: errors.New("insert failed"), wantEvents: []string{"probe", "begin", "check_result", "rollback"}},
		{name: "monitor update error", failAt: "monitor", failure: errors.New("update failed"), wantEvents: []string{"probe", "begin", "check_result", "monitor", "rollback"}},
		{name: "alert insert error", failAt: "alert", failure: errors.New("alert failed"), wantEvents: []string{"probe", "begin", "check_result", "monitor", "alert", "rollback"}},
		{name: "commit error", failAt: "commit", failure: errors.New("commit failed"), wantEvents: []string{"probe", "begin", "check_result", "monitor", "commit", "rollback"}},
		{name: "check result concurrent delete", failAt: "check_result", failure: &pgconn.PgError{Code: "23503"}, wantNil: true, wantEvents: []string{"probe", "begin", "check_result", "rollback"}},
		{name: "monitor concurrent delete", zero: true, wantNil: true, wantEvents: []string{"probe", "begin", "check_result", "monitor", "rollback"}},
		{name: "alert concurrent delete", failAt: "alert", failure: &pgconn.PgError{Code: "23503"}, wantNil: true, wantEvents: []string{"probe", "begin", "check_result", "monitor", "alert", "rollback"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			events := []string{}
			db := newRecordingDB(&events)
			db.beginErr = tt.dbBegin
			db.tx.zeroUpdate = tt.zero
			if tt.failAt != "begin" {
				db.tx.errors[tt.failAt] = tt.failure
			}
			old := "healthy"
			if tt.failAt == "alert" || tt.name == "alert concurrent delete" {
				old = "healthy"
				db.tx.errors["alert"] = tt.failure
			}
			if tt.name == "alert insert error" || tt.name == "alert concurrent delete" {
				db.tx.errors["alert"] = tt.failure
			}
			m := checker.Monitor{ID: 3, Name: "test", LastState: &old, ConsecutiveFailures: 2}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tt.failAt == "commit" {
				db.tx.cancelParent = cancel
			}
			name := "recorded-" + t.Name()
			probeState := "unhealthy"
			if tt.failAt == "commit" {
				probeState = "healthy"
			}
			registerRecordingChecker(name, &events, checker.Result{State: probeState}, nil)
			m.CheckType = name
			err := checkAndPersist(ctx, db, m, time.Second, 3)
			if tt.wantNil && err != nil {
				t.Fatalf("err=%v want nil", err)
			}
			if !tt.wantNil && err == nil {
				t.Fatal("expected error")
			}
			assertSequence(t, events, tt.wantEvents)
			if tt.failAt != "begin" && (!db.tx.rolledBack || db.tx.committed) {
				t.Fatalf("rolledBack=%v committed=%v", db.tx.rolledBack, db.tx.committed)
			}
			if tt.failAt == "commit" && !db.tx.rollbackContextLive {
				t.Fatal("rollback cleanup context canceled with parent")
			}
		})
	}
}

func TestEvaluateFSMDoesNotAliasStateAndClampsFailures(t *testing.T) {
	state := "healthy"
	got := evaluateFSM(&state, -5, "unhealthy", 3)
	state = "changed"
	if got.state == nil || *got.state != "healthy" || got.consecutiveFailures != 1 {
		t.Fatalf("FSM result aliases or fails to clamp: %#v", got)
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
