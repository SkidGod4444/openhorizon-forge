package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultBaseURL = "http://localhost:8080"

// apiClient is a tiny HTTP wrapper around the control-plane API.
// It centralises authentication, request body encoding, and error
// translation so subcommands stay focused on routing logic.
type apiClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

func newAPIClient(opts *rootOptions) *apiClient {
	base := firstNonEmpty(
		opts.apiBaseURL,
		os.Getenv("OHCTL_API_BASE_URL"),
		os.Getenv("OHFORGE_API_BASE_URL"),
		defaultBaseURL,
	)
	key := firstNonEmpty(opts.apiKey, os.Getenv("OHCTL_API_KEY"))

	timeout := opts.timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	return &apiClient{
		baseURL:    strings.TrimRight(base, "/"),
		apiKey:     key,
		httpClient: &http.Client{Timeout: timeout},
	}
}

// apiError is returned for any HTTP response with status >= 400.
// It preserves the status code and raw body so callers can render
// either the API's structured `{ "error": { "code", "message" } }`
// payload or fall back to the raw text.
type apiError struct {
	StatusCode int
	Path       string
	Body       []byte
}

func (e *apiError) Error() string {
	if msg := extractAPIErrorMessage(e.Body); msg != "" {
		return fmt.Sprintf("HTTP %d %s: %s", e.StatusCode, e.Path, msg)
	}
	body := strings.TrimSpace(string(e.Body))
	if body == "" {
		return fmt.Sprintf("HTTP %d %s", e.StatusCode, e.Path)
	}
	return fmt.Sprintf("HTTP %d %s: %s", e.StatusCode, e.Path, body)
}

// IsClientError returns true for 4xx responses.
func (e *apiError) IsClientError() bool { return e.StatusCode >= 400 && e.StatusCode < 500 }

// extractAPIErrorMessage tries a few common shapes returned by Hono /
// Zod validators so we can render concise error messages.
func extractAPIErrorMessage(body []byte) string {
	var parsed struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return ""
	}
	if parsed.Error.Message != "" {
		if parsed.Error.Code != "" {
			return fmt.Sprintf("%s (code=%s)", parsed.Error.Message, parsed.Error.Code)
		}
		return parsed.Error.Message
	}
	return parsed.Message
}

func (c *apiClient) do(ctx context.Context, method, path string, body any) ([]byte, error) {
	var payload io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request body: %w", err)
		}
		payload = bytes.NewReader(buf)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, payload)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "ohctl/"+Version)
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// Surface context cancellation untouched so the root command
		// can rewrite it to "cancelled".
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, fmt.Errorf("request %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, &apiError{StatusCode: resp.StatusCode, Path: path, Body: data}
	}
	return data, nil
}
