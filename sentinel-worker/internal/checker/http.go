package checker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	defaultCheckTimeout = 10 * time.Second
	maxCheckTimeout     = 15 * time.Second
	maxResponseBodyRead = 500
)

type HTTPChecker struct {
	Client       *http.Client
	AllowedPorts map[int]bool
}

// NewHTTPChecker creates an HTTPChecker configured with SSRF protection.
func NewHTTPChecker(allowedPorts map[int]bool) *HTTPChecker {
	if allowedPorts == nil {
		allowedPorts = ParseAllowedPorts("")
	}
	return &HTTPChecker{
		Client: NewSafeHTTPClient(SafeTransportConfig{
			AllowedPorts: allowedPorts,
		}),
		AllowedPorts: allowedPorts,
	}
}

func (h *HTTPChecker) Check(ctx context.Context, m Monitor) (Result, error) {
	client := h.Client
	if client == nil {
		client = NewSafeHTTPClient(SafeTransportConfig{
			AllowedPorts: h.AllowedPorts,
		})
	}

	allowedPorts := h.AllowedPorts
	if allowedPorts == nil {
		allowedPorts = ParseAllowedPorts("")
	}

	// Pre-validate target URL scheme and port
	if _, err := ValidateTargetURL(m.Target, allowedPorts); err != nil {
		errMsg := fmt.Sprintf("invalid monitor target: %v", err)
		return Result{State: "unhealthy", ErrorMessage: &errMsg}, nil
	}

	method := "GET"
	timeout := defaultCheckTimeout
	expectedStatus := 200

	if m.CheckConfig != nil {
		var cfg map[string]any
		_ = json.Unmarshal(m.CheckConfig, &cfg)
		if meth, ok := cfg["method"].(string); ok && meth != "" {
			method = meth
		}
		if s, ok := cfg["expected_status"].(float64); ok {
			expectedStatus = int(s)
		}
		if t, ok := cfg["timeout"].(float64); ok && t > 0 {
			reqTimeout := time.Duration(t) * time.Second
			if reqTimeout > maxCheckTimeout {
				reqTimeout = maxCheckTimeout
			}
			timeout = reqTimeout
		}
	}

	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, method, m.Target, nil)
	if err != nil {
		errMsg := fmt.Sprintf("invalid request: %v", err)
		return Result{State: "unhealthy", ErrorMessage: &errMsg}, nil
	}

	// Standard User-Agent for the monitoring probe
	req.Header.Set("User-Agent", "Sentinel-Monitor/1.0")

	start := time.Now()
	resp, err := client.Do(req)
	latency := float64(time.Since(start).Microseconds()) / 1000.0

	if err != nil {
		errMsg := err.Error()
		return Result{State: "unhealthy", LatencyMs: latency, ErrorMessage: &errMsg}, nil
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxResponseBodyRead))
	statusCode := resp.StatusCode
	sample := string(body)

	state := "unhealthy"
	if statusCode == expectedStatus {
		state = "healthy"
	}

	return Result{
		State:          state,
		LatencyMs:      latency,
		StatusCode:     &statusCode,
		ResponseSample: &sample,
	}, nil
}
