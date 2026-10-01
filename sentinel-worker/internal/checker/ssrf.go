package checker

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var (
	ErrDisallowedScheme = errors.New("ssrf: only http and https schemes are allowed")
	ErrDisallowedPort   = errors.New("ssrf: target port is not allowed")
	ErrBlockedIP        = errors.New("ssrf: target IP address is blocked")
	ErrTooManyRedirects = errors.New("ssrf: too many redirects (max 3)")
	ErrNoIPResolved     = errors.New("ssrf: no IP addresses resolved for host")
)

var defaultBlockedIPv4CIDRs = []string{
	"0.0.0.0/8",      // Current network (RFC 1122)
	"10.0.0.0/8",     // Private IPv4 (RFC 1918)
	"100.64.0.0/10",  // Shared Address Space / CGNAT (RFC 6598)
	"127.0.0.0/8",    // Loopback IPv4 (RFC 1122)
	"169.254.0.0/16", // Link-local / Cloud Metadata (RFC 3927)
	"172.16.0.0/12",  // Private IPv4 (RFC 1918)
	"192.168.0.0/16", // Private IPv4 (RFC 1918)
	"224.0.0.0/4",    // Multicast (RFC 5771)
	"240.0.0.0/4",    // Reserved (RFC 1112)
}

var defaultBlockedIPv6CIDRs = []string{
	"::/128",    // Unspecified IPv6
	"::1/128",   // Loopback IPv6 (RFC 4291)
	"fc00::/7",  // Unique Local IPv6 (RFC 4193)
	"fe80::/10", // Link-local Unicast IPv6 (RFC 4291)
	"ff00::/8",  // Multicast IPv6 (RFC 4291)
}

var (
	blockedIPv4Nets []*net.IPNet
	blockedIPv6Nets []*net.IPNet
)

func init() {
	for _, cidr := range defaultBlockedIPv4CIDRs {
		_, ipNet, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(fmt.Sprintf("invalid CIDR in blocked IPv4 list: %s: %v", cidr, err))
		}
		blockedIPv4Nets = append(blockedIPv4Nets, ipNet)
	}
	for _, cidr := range defaultBlockedIPv6CIDRs {
		_, ipNet, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(fmt.Sprintf("invalid CIDR in blocked IPv6 list: %s: %v", cidr, err))
		}
		blockedIPv6Nets = append(blockedIPv6Nets, ipNet)
	}
}

// IPResolver resolves IP addresses for hostnames.
type IPResolver interface {
	LookupIP(ctx context.Context, network, host string) ([]net.IP, error)
}

// defaultResolver uses net.DefaultResolver.
type defaultResolver struct{}

func (d *defaultResolver) LookupIP(ctx context.Context, network, host string) ([]net.IP, error) {
	return net.DefaultResolver.LookupIP(ctx, network, host)
}

// SafeTransportConfig configures the SSRF-protected transport.
type SafeTransportConfig struct {
	AllowedPorts map[int]bool
	Resolver     IPResolver
	DialTimeout  time.Duration
	TLSConfig    *tls.Config
	DialContext  func(ctx context.Context, network, addr string) (net.Conn, error)
}

// ParseAllowedPorts parses a comma-separated list of port numbers.
// If the input is empty, it returns default ports: 80, 443, 8080, 8443.
func ParseAllowedPorts(raw string) map[int]bool {
	ports := make(map[int]bool)
	if strings.TrimSpace(raw) == "" {
		ports[80] = true
		ports[443] = true
		ports[8080] = true
		ports[8443] = true
		return ports
	}

	for _, item := range strings.Split(raw, ",") {
		p := strings.TrimSpace(item)
		if p == "" {
			continue
		}
		portNum, err := strconv.Atoi(p)
		if err == nil && portNum > 0 && portNum <= 65535 {
			ports[portNum] = true
		}
	}

	if len(ports) == 0 {
		ports[80] = true
		ports[443] = true
		ports[8080] = true
		ports[8443] = true
	}
	return ports
}

// IsIPBlocked returns true if the IP belongs to private, loopback, link-local,
// cloud metadata or other reserved network ranges.
func IsIPBlocked(ip net.IP) bool {
	if ip == nil {
		return true
	}

	// If it's IPv4 or an IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1), unwrap and test as IPv4
	if ipv4 := ip.To4(); ipv4 != nil {
		for _, ipNet := range blockedIPv4Nets {
			if ipNet.Contains(ipv4) {
				return true
			}
		}
		if ipv4.IsLoopback() || ipv4.IsPrivate() || ipv4.IsLinkLocalUnicast() || ipv4.IsLinkLocalMulticast() || ipv4.IsMulticast() || ipv4.IsUnspecified() {
			return true
		}
		return false
	}

	// Native IPv6 check
	for _, ipNet := range blockedIPv6Nets {
		if ipNet.Contains(ip) {
			return true
		}
	}

	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}

	return false
}

// ValidateTargetURL inspects a URL string ensuring valid scheme and allowed port.
func ValidateTargetURL(rawURL string, allowedPorts map[int]bool) (*url.URL, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, ErrDisallowedScheme
	}

	host := u.Host
	if host == "" {
		return nil, errors.New("ssrf: URL host is empty")
	}

	port := 80
	if scheme == "https" {
		port = 443
	}

	if strings.Contains(host, ":") {
		_, p, err := net.SplitHostPort(host)
		if err == nil {
			if parsedPort, err := strconv.Atoi(p); err == nil {
				port = parsedPort
			}
		}
	}

	if allowedPorts != nil && !allowedPorts[port] {
		return nil, fmt.Errorf("%w: %d", ErrDisallowedPort, port)
	}

	return u, nil
}

// NewSafeHTTPClient returns an *http.Client configured to prevent SSRF and DNS rebinding attacks.
func NewSafeHTTPClient(cfg SafeTransportConfig) *http.Client {
	if cfg.AllowedPorts == nil {
		cfg.AllowedPorts = ParseAllowedPorts("")
	}
	if cfg.Resolver == nil {
		cfg.Resolver = &defaultResolver{}
	}
	if cfg.DialTimeout <= 0 {
		cfg.DialTimeout = 5 * time.Second
	}

	baseDialer := cfg.DialContext
	if baseDialer == nil {
		netDialer := &net.Dialer{
			Timeout:   cfg.DialTimeout,
			KeepAlive: 30 * time.Second,
		}
		baseDialer = netDialer.DialContext
	}

	tlsClientConfig := cfg.TLSConfig
	if tlsClientConfig == nil {
		tlsClientConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
		}
	} else if tlsClientConfig.MinVersion == 0 {
		tlsClientConfig.MinVersion = tls.VersionTLS12
	}

	transport := &http.Transport{
		// Explicitly disable system proxy to prevent bypassing SSRF filters
		Proxy: nil,

		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, portStr, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, fmt.Errorf("ssrf: invalid target address: %w", err)
			}

			port, err := strconv.Atoi(portStr)
			if err != nil {
				return nil, fmt.Errorf("ssrf: invalid target port: %w", err)
			}

			if !cfg.AllowedPorts[port] {
				return nil, fmt.Errorf("%w: %d", ErrDisallowedPort, port)
			}

			// If host is already an IP literal
			if parsedIP := net.ParseIP(strings.Trim(host, "[]")); parsedIP != nil {
				if IsIPBlocked(parsedIP) {
					return nil, fmt.Errorf("%w: %s", ErrBlockedIP, parsedIP.String())
				}
				// Pin socket connection to this validated IP
				return baseDialer(ctx, network, net.JoinHostPort(parsedIP.String(), portStr))
			}

			// Hostname: resolve DNS and validate all resolved IPs
			ips, err := cfg.Resolver.LookupIP(ctx, "ip", host)
			if err != nil {
				return nil, fmt.Errorf("ssrf: DNS resolution failed for %s: %w", host, err)
			}
			if len(ips) == 0 {
				return nil, fmt.Errorf("%w for %s", ErrNoIPResolved, host)
			}

			// If ANY resolved IP is in a blocked range, abort connection
			for _, ip := range ips {
				if IsIPBlocked(ip) {
					return nil, fmt.Errorf("%w: host %s resolved to blocked IP %s", ErrBlockedIP, host, ip.String())
				}
			}

			// Socket pinning: dial the first validated IP directly to prevent DNS rebinding
			pinnedIP := ips[0]
			return baseDialer(ctx, network, net.JoinHostPort(pinnedIP.String(), portStr))
		},

		TLSClientConfig:       tlsClientConfig,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		MaxIdleConns:          50,
		IdleConnTimeout:       30 * time.Second,
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return ErrTooManyRedirects
			}

			// Revalidate redirect destination URL
			_, err := ValidateTargetURL(req.URL.String(), cfg.AllowedPorts)
			if err != nil {
				return fmt.Errorf("redirect blocked: %w", err)
			}

			return nil
		},
	}

	return client
}
