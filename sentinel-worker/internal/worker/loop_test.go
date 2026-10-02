package worker

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

type insertFakeExecer struct {
	err error
}

func (f insertFakeExecer) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, f.err
}

func TestInsertResultOutcome(t *testing.T) {
	for _, tt := range []struct {
		name string
		err  error
		want insertOutcome
	}{{"deleted monitor", &pgconn.PgError{Code: "23503"}, insertMonitorDeleted}, {"other database error", errors.New("database unavailable"), insertFailed}, {"success", nil, insertSucceeded}} {
		t.Run(tt.name, func(t *testing.T) {
			got := insertResult(context.Background(), insertFakeExecer{tt.err}, "INSERT check_result", nil)
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
			got := insertAlert(context.Background(), insertFakeExecer{tt.err}, "INSERT alert", nil)
			if got.outcome != tt.want {
				t.Fatalf("outcome=%v want=%v", got.outcome, tt.want)
			}
			if tt.want == insertFailed && !errors.Is(got.err, tt.err) {
				t.Fatalf("error=%v want %v", got.err, tt.err)
			}
		})
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
