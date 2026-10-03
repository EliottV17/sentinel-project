package worker

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestParseDemoManifestAcceptsVariableEntryCount(t *testing.T) {
	manifest := []byte(`[{"seed_key":"one","name":"One","target":"https://one.example","frequency":60,"check_type":"http"},{"seed_key":"two","name":"Two","target":"https://two.example","frequency":60,"check_type":"http"},{"seed_key":"three","name":"Three","target":"https://three.example","frequency":60,"check_type":"http"}]`)
	got, err := parseDemoManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("parsed %d entries, want 3", len(got))
	}
	if _, err := parseDemoManifest([]byte(`[]`)); err == nil {
		t.Fatal("empty manifest should fail")
	}
}

type fakeDemoRow struct {
	id      int
	err     error
	waitFor context.Context
	slow    bool
}

func (r fakeDemoRow) Scan(dest ...any) error {
	if r.waitFor != nil {
		<-r.waitFor.Done()
		return r.waitFor.Err()
	}
	if r.err != nil {
		return r.err
	}
	*(dest[0].(*int)) = r.id
	return nil
}

type execCall struct {
	query string
	args  []any
}
type fakeDemoTx struct {
	calls                []execCall
	committed            bool
	rolledBack           bool
	failAt               int
	monitorOwners        map[int]int
	historyMonitorOwners map[int]int
	nextMonitorID        int
}

func (tx *fakeDemoTx) Exec(_ context.Context, q string, args ...any) (pgconn.CommandTag, error) {
	tx.calls = append(tx.calls, execCall{q, args})
	if tx.failAt > 0 && len(tx.calls) == tx.failAt {
		return pgconn.CommandTag{}, errors.New("manifest insert failed")
	}
	userID := 0
	if len(args) > 0 {
		userID, _ = args[0].(int)
	}
	switch q {
	case `DELETE FROM check_result WHERE monitor_id IN (SELECT id FROM monitor WHERE user_id = $1)`:
		for id, ownerID := range tx.historyMonitorOwners {
			if tx.monitorOwners[ownerID] == userID {
				delete(tx.historyMonitorOwners, id)
			}
		}
	case `DELETE FROM monitor WHERE user_id = $1`:
		for id, ownerID := range tx.monitorOwners {
			if ownerID == userID {
				delete(tx.monitorOwners, id)
			}
		}
	case `INSERT INTO monitor (user_id, name, target, check_type, check_config, frequency, state, seed_key, created_at, consecutive_failures) VALUES ($1,$2,$3,$4,$5,$6,'Active',$7,CURRENT_TIMESTAMP,0)`:
		tx.nextMonitorID++
		if tx.monitorOwners != nil {
			tx.monitorOwners[tx.nextMonitorID] = userID
		}
	}
	return pgconn.NewCommandTag("OK"), nil
}
func (tx *fakeDemoTx) Commit(context.Context) error   { tx.committed = true; return nil }
func (tx *fakeDemoTx) Rollback(context.Context) error { tx.rolledBack = true; return nil }

type fakeDemoDB struct {
	row   fakeDemoRow
	tx    *fakeDemoTx
	query string
	args  []any
}

func (db *fakeDemoDB) QueryRow(ctx context.Context, q string, args ...any) pgx.Row {
	if db.row.slow {
		db.row.waitFor = ctx
	}
	db.query = q
	db.args = args
	return db.row
}
func (db *fakeDemoDB) Begin(context.Context) (demoResetTx, error) { return db.tx, nil }

func TestResetDemoAccountScopesAndRestoresManifest(t *testing.T) {
	manifest := []byte(`[{"seed_key":"one","name":"One","target":"https://example.com","frequency":60,"check_type":"http","check_config":{}},{"seed_key":"two","name":"Two","target":"https://api.github.com","frequency":60,"check_type":"http","check_config":{}}]`)
	path := filepath.Join(t.TempDir(), "manifest.json")
	if err := os.WriteFile(path, manifest, 0600); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name      string
		rowErr    error
		wantCalls int
	}{{"user missing", pgx.ErrNoRows, 0}, {"identified demo user", nil, 5}} {
		t.Run(tt.name, func(t *testing.T) {
			tx := &fakeDemoTx{}
			db := &fakeDemoDB{row: fakeDemoRow{id: 42, err: tt.rowErr}, tx: tx}
			if err := resetDemoAccount(context.Background(), db, "demo@example.test", path); err != nil {
				t.Fatal(err)
			}
			if db.query != `SELECT id FROM users WHERE email = $1 AND is_demo = true` || !reflect.DeepEqual(db.args, []any{"demo@example.test"}) {
				t.Fatalf("unexpected user lookup: %s %#v", db.query, db.args)
			}
			if len(tx.calls) != tt.wantCalls {
				t.Fatalf("calls=%d want=%d", len(tx.calls), tt.wantCalls)
			}
			if tt.wantCalls == 0 {
				if tx.committed {
					t.Fatal("missing user should not commit")
				}
				return
			}
			for _, call := range tx.calls[:3] {
				if !reflect.DeepEqual(call.args, []any{42}) {
					t.Fatalf("delete not scoped to resolved user: %#v", call)
				}
			}
			if tx.calls[2].query != `DELETE FROM monitor WHERE user_id = $1` {
				t.Fatalf("unexpected monitor delete: %#v", tx.calls[2])
			}
			for i, wantKey := range []string{"one", "two"} {
				call := tx.calls[i+3]
				if call.query != `INSERT INTO monitor (user_id, name, target, check_type, check_config, frequency, state, seed_key, created_at, consecutive_failures) VALUES ($1,$2,$3,$4,$5,$6,'Active',$7,CURRENT_TIMESTAMP,0)` || len(call.args) != 7 || call.args[0] != 42 || call.args[6] != wantKey {
					t.Fatalf("unexpected restored seed: %#v", call)
				}
			}
			if !tx.committed {
				t.Fatal("transaction was not committed")
			}
		})
	}
}

func TestResetDemoAccountPreservesStatusOwnerMonitorsAndCheckHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manifest.json")
	if err := os.WriteFile(path, []byte(`[{"seed_key":"replacement","name":"Replacement","target":"https://example.com","frequency":60,"check_type":"http"}]`), 0600); err != nil {
		t.Fatal(err)
	}
	tx := &fakeDemoTx{
		monitorOwners:        map[int]int{601: 42, 901: 99},
		historyMonitorOwners: map[int]int{7001: 601, 9001: 901},
	}
	db := &fakeDemoDB{row: fakeDemoRow{id: 42}, tx: tx}

	if err := resetDemoAccount(context.Background(), db, "demo@example.test", path); err != nil {
		t.Fatal(err)
	}
	if _, exists := tx.monitorOwners[901]; !exists {
		t.Fatal("demo reset removed the public status owner's monitor")
	}
	if monitorID, exists := tx.historyMonitorOwners[9001]; !exists || monitorID != 901 {
		t.Fatal("demo reset removed the public status owner's check history")
	}
	if _, exists := tx.monitorOwners[601]; exists {
		t.Fatal("demo reset did not replace the demo monitor")
	}
	if tx.monitorOwners[tx.nextMonitorID] != 42 {
		t.Fatalf("restored monitor owner=%d, want demo user 42", tx.monitorOwners[tx.nextMonitorID])
	}
	if _, exists := tx.historyMonitorOwners[7001]; exists {
		t.Fatal("demo reset retained demo check history")
	}
}

func TestResetDemoAccountRollsBackManifestInsertFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manifest.json")
	if err := os.WriteFile(path, []byte(`[{"seed_key":"one","name":"One","target":"https://one.example","frequency":60,"check_type":"http"}]`), 0600); err != nil {
		t.Fatal(err)
	}
	tx := &fakeDemoTx{failAt: 4}
	db := &fakeDemoDB{row: fakeDemoRow{id: 42}, tx: tx}
	if err := resetDemoAccount(context.Background(), db, "demo@example.test", path); err == nil {
		t.Fatal("expected manifest insert failure")
	}
	if !tx.rolledBack || tx.committed {
		t.Fatalf("rollback=%v commit=%v; want rollback without commit", tx.rolledBack, tx.committed)
	}
}

func TestResetDemoAccountNoopsWhenUnconfigured(t *testing.T) {
	if err := resetDemoAccount(context.Background(), nil, "", ""); err != nil {
		t.Fatalf("got %v", err)
	}
}

func TestResetDemoAccountBoundsSlowLookup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manifest.json")
	if err := os.WriteFile(path, []byte(`[{"seed_key":"one","name":"One","target":"https://one.example","frequency":60,"check_type":"http"}]`), 0600); err != nil {
		t.Fatal(err)
	}
	db := &fakeDemoDB{row: fakeDemoRow{slow: true}, tx: &fakeDemoTx{}}
	started := time.Now()
	err := resetDemoAccount(context.Background(), db, "demo@example.test", path, 20*time.Millisecond)
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > time.Second {
		t.Fatalf("slow lookup error=%v elapsed=%s", err, time.Since(started))
	}
	if db.tx.committed {
		t.Fatal("timed out reset committed")
	}
}
