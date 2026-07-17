import (
	"encoding/json"
	"time"
)

type Monitor struct {
	ID                  int             `db:"id"`
	Name                string          `db:"name"`
	Target              string          `db:"target"`
	CheckType           string          `db:"check_type"`
	CheckConfig         json.RawMessage `db:"check_config"`
	Frequency           int             `db:"frequency"`
	LastState           *string         `db:"last_state"`
	LastCheckedAt       *time.Time      `db:"last_checked_at"`
	ConsecutiveFailures int             `db:"consecutive_failures"`
}
