package checker

import (
	"context"
	"fmt"
	"net/http"

	"encoding/json"
	"io"
	"time"
)

type HTTPChecker struct {
	Client *http.Client
}

func (h *HTTPChecker) Check(ctx context.Context, m Monitor) (Result, error) {
	client := h.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	method := "GET"
	timeout := 10 * time.Second
	expectedStatus := 200

	if m.CheckConfig != nil {
		var cfg map[string]any
		_ = json.Unmarshal(m.CheckConfig, &cfg)
		if m, ok := cfg["method"].(string); ok {
			method = m
		}
		if s, ok := cfg["expected_status"].(float64); ok {
			expectedStatus = int(s)
		}
		if t, ok := cfg["timeout"].(float64); ok {
			timeout = time.Duration(t) * time.Second
			client.Timeout = timeout
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, m.Target, nil)
	if err != nil {
		errMsg := fmt.Sprintf("invalid request: %v", err)
		return Result{State: "unhealthy", ErrorMessage: &errMsg}, nil
	}

	start := time.Now()
	resp, err := client.Do(req)
	latency := float64(time.Since(start).Microseconds()) / 1000.0

	if err != nil {
		errMsg := err.Error()
		return Result{State: "unhealthy", LatencyMs: latency, ErrorMessage: &errMsg}, nil
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
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