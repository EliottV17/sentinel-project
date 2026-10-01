package checker

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type mockResolver struct {
	hosts map[string][]net.IP
}

func (m *mockResolver) LookupIP(ctx context.Context, network, host string) ([]net.IP, error) {
	if ips, ok := m.hosts[host]; ok {
		return ips, nil
	}
	return nil, fmt.Errorf("host not found in mock: %s", host)
}

func TestIsIPBlocked(t *testing.T) {
	tests := []struct {
		name    string
		ipStr   string
		blocked bool
	}{
		// Loopback
		{"IPv4 Loopback 127.0.0.1", "127.0.0.1", true},
		{"IPv4 Loopback 127.1.2.3", "127.1.2.3", true},
		{"IPv6 Loopback ::1", "::1", true},

		// Cloud metadata / link-local
		{"AWS/GCP/Azure Metadata 169.254.169.254", "169.254.169.254", true},
		{"Link-local IPv4 169.254.1.1", "169.254.1.1", true},
		{"Link-local IPv6 fe80::1", "fe80::1", true},

		// RFC 1918 Private IPv4
		{"Private 10.0.0.1", "10.0.0.1", true},
		{"Private 10.255.255.255", "10.255.255.255", true},
		{"Private 172.16.0.1", "172.16.0.1", true},
		{"Private 172.24.0.1", "172.24.0.1", true},
		{"Private 172.31.255.254", "172.31.255.254", true},
		{"Private 192.168.0.1", "192.168.0.1", true},
		{"Private 192.168.1.100", "192.168.1.100", true},

		// Current network & CGNAT
		{"Current network 0.0.0.0", "0.0.0.0", true},
		{"CGNAT 100.64.0.1", "100.64.0.1", true},
		{"CGNAT 100.127.255.254", "100.127.255.254", true},

		// Multicast & IPv6 Unique Local
		{"IPv4 Multicast 224.0.0.1", "224.0.0.1", true},
		{"IPv6 Multicast ff02::1", "ff02::1", true},
		{"IPv6 ULA fc00::1", "fc00::1", true},
		{"IPv6 ULA fd12:3456::1", "fd12:3456::1", true},

		// IPv4-mapped IPv6
		{"IPv4-mapped Loopback ::ffff:127.0.0.1", "::ffff:127.0.0.1", true},
		{"IPv4-mapped 10.x ::ffff:10.0.0.1", "::ffff:10.0.0.1", true},
		{"IPv4-mapped 192.168.x ::ffff:192.168.1.1", "::ffff:192.168.1.1", true},
		{"IPv4-mapped Metadata ::ffff:169.254.169.254", "::ffff:169.254.169.254", true},

		// Public allowed IPs
		{"Cloudflare DNS 1.1.1.1", "1.1.1.1", false},
		{"Google DNS 8.8.8.8", "8.8.8.8", false},
		{"Public example 93.184.216.34", "93.184.216.34", false},
		{"Public IPv6 2606:4700:4700::1111", "2606:4700:4700::1111", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ip := net.ParseIP(tt.ipStr)
			if ip == nil {
				t.Fatalf("failed to parse test IP: %s", tt.ipStr)
			}
			blocked := IsIPBlocked(ip)
			if blocked != tt.blocked {
				t.Errorf("IsIPBlocked(%s) = %v; want %v", tt.ipStr, blocked, tt.blocked)
			}
		})
	}
}

func TestValidateTargetURL(t *testing.T) {
	allowedPorts := ParseAllowedPorts("80,443,8080,8443")

	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"Valid HTTP", "http://example.com/health", false},
		{"Valid HTTPS", "https://example.com/api", false},
		{"Valid custom allowed port 8080", "http://example.com:8080/metrics", false},
		{"Valid custom allowed port 8443", "https://example.com:8443/status", false},

		{"Disallowed scheme ftp", "ftp://example.com/file", true},
		{"Disallowed scheme file", "file:///etc/passwd", true},
		{"Disallowed scheme gopher", "gopher://example.com/", true},
		{"Disallowed scheme empty", "://example.com", true},

		{"Disallowed port 22 (SSH)", "http://example.com:22/", true},
		{"Disallowed port 3306 (MySQL)", "http://example.com:3306/", true},
		{"Disallowed port 5432 (Postgres)", "http://example.com:5432/", true},
		{"Disallowed port 6379 (Redis)", "http://example.com:6379/", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ValidateTargetURL(tt.url, allowedPorts)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTargetURL(%q) err = %v; wantErr %v", tt.url, err, tt.wantErr)
			}
		})
	}
}

func TestSSRFBlockedTargets(t *testing.T) {
	mockRes := &mockResolver{
		hosts: map[string][]net.IP{
			"localhost":              {net.ParseIP("127.0.0.1")},
			"internal.local":         {net.ParseIP("10.0.0.5")},
			"metadata.cloud":         {net.ParseIP("169.254.169.254")},
			"home.router":            {net.ParseIP("192.168.1.1")},
			"cgnat.test":             {net.ParseIP("100.64.1.1")},
			"ipv4mapped.test":        {net.ParseIP("::ffff:127.0.0.1")},
			"db":                     {net.ParseIP("172.18.0.2")}, // Docker internal postgres
			"api":                    {net.ParseIP("172.18.0.3")}, // Docker internal api
			"mixed-dns.attacker.com": {net.ParseIP("93.184.216.34"), net.ParseIP("127.0.0.1")}, // Mixed DNS with private IP
		},
	}

	allowedPorts := ParseAllowedPorts("80,443,8080,8443")
	client := NewSafeHTTPClient(SafeTransportConfig{
		AllowedPorts: allowedPorts,
		Resolver:     mockRes,
		DialTimeout:  500 * time.Millisecond,
	})

	checker := &HTTPChecker{
		Client:       client,
		AllowedPorts: allowedPorts,
	}

	targets := []struct {
		name   string
		target string
	}{
		{"Direct loopback IP", "http://127.0.0.1:8080/status"},
		{"Localhost hostname", "http://localhost:8080/status"},
		{"Private 10.x", "http://internal.local/ping"},
		{"Private 192.168.x", "http://home.router/admin"},
		{"Cloud metadata 169.254.169.254 direct", "http://169.254.169.254/latest/meta-data"},
		{"Cloud metadata hostname", "http://metadata.cloud/latest/meta-data"},
		{"Docker Compose service db", "http://db:5432/"},
		{"Docker Compose service api", "http://api:8000/"},
		{"CGNAT address", "http://cgnat.test/"},
		{"IPv4-mapped IPv6 address", "http://ipv4mapped.test/"},
		{"Mixed DNS attacker", "http://mixed-dns.attacker.com/"},
	}

	for _, tt := range targets {
		t.Run(tt.name, func(t *testing.T) {
			res, err := checker.Check(context.Background(), Monitor{
				Target: tt.target,
			})
			if err != nil {
				t.Fatalf("unexpected checker error: %v", err)
			}
			if res.State != "unhealthy" {
				t.Errorf("expected state unhealthy for target %s, got %s", tt.target, res.State)
			}
			if res.ErrorMessage == nil || *res.ErrorMessage == "" {
				t.Errorf("expected non-empty ErrorMessage for blocked target %s", tt.target)
			}
		})
	}
}

func TestSSRFRedirectToInternalBlocked(t *testing.T) {
	// A server that responds with a redirect to internal cloud metadata
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data", http.StatusFound)
	}))
	defer ts.Close()

	// Parse test server address
	serverURL, err := ValidateTargetURL(ts.URL, nil)
	if err != nil {
		t.Fatalf("failed to parse test server url: %v", err)
	}

	serverHost, serverPortStr, _ := net.SplitHostPort(serverURL.Host)
	serverIP := net.ParseIP(serverHost)

	// Custom resolver and allowed ports for test server
	serverPort := 80
	fmt.Sscanf(serverPortStr, "%d", &serverPort)

	allowedPorts := map[int]bool{
		80:         true,
		443:        true,
		serverPort: true,
	}

	// We allow serverIP in mock resolver for the test server itself
	mockRes := &mockResolver{
		hosts: map[string][]net.IP{
			"testserver.public": {serverIP},
		},
	}

	client := NewSafeHTTPClient(SafeTransportConfig{
		AllowedPorts: allowedPorts,
		Resolver:     mockRes,
		DialTimeout:  500 * time.Millisecond,
	})

	// Directly using client with redirect to 169.254.169.254
	req, _ := http.NewRequestWithContext(context.Background(), "GET", ts.URL, nil)
	_, err = client.Do(req)
	if err == nil {
		t.Errorf("expected redirect to 169.254.169.254 to be blocked, but request succeeded")
	}
}

func TestSSRFTooManyRedirects(t *testing.T) {
	var ts *httptest.Server
	redirectCount := 0
	ts = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectCount++
		http.Redirect(w, r, ts.URL, http.StatusFound)
	}))
	defer ts.Close()

	client := NewSafeHTTPClient(SafeTransportConfig{
		AllowedPorts: map[int]bool{80: true, 443: true},
	})

	// CheckRedirect should stop after 3 redirects
	req, _ := http.NewRequestWithContext(context.Background(), "GET", ts.URL, nil)
	_, err := client.Do(req)
	if err == nil {
		t.Errorf("expected error after 3 redirects, got nil")
	}
}

func TestDNSRebindingDefense(t *testing.T) {
	// Scenario: Attacker domain responds with mixed IPs (public IP + private IP)
	// or alternates responses to trigger DNS rebinding.
	mockRes := &mockResolver{
		hosts: map[string][]net.IP{
			"rebinding-mixed.attacker.com": {
				net.ParseIP("93.184.216.34"),
				net.ParseIP("169.254.169.254"), // Private metadata
			},
		},
	}

	client := NewSafeHTTPClient(SafeTransportConfig{
		AllowedPorts: map[int]bool{80: true, 443: true},
		Resolver:     mockRes,
		DialTimeout:  500 * time.Millisecond,
	})

	req, _ := http.NewRequestWithContext(context.Background(), "GET", "http://rebinding-mixed.attacker.com/", nil)
	_, err := client.Do(req)
	if err == nil {
		t.Fatalf("expected DNS rebinding mixed response to be blocked, but request succeeded")
	}
}
