package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/spf13/cobra"
)

func newJobCmd(opts *rootOptions) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "job",
		Short: "Manage training jobs on the control plane",
	}
	cmd.AddCommand(
		newJobPushCmd(opts),
		newJobListCmd(opts),
		newJobStatusCmd(opts),
		newJobLogsCmd(opts),
		newJobSyncCmd(opts),
		newJobCancelCmd(opts),
		newJobCheckpointsCmd(opts),
		newJobResumeCmd(opts),
		newJobArtifactsCmd(opts),
		newJobArtifactCmd(opts),
		newJobWatchCmd(opts),
	)
	return cmd
}

// ---------------------------------------------------------------------------
// job push
// ---------------------------------------------------------------------------

func newJobPushCmd(opts *rootOptions) *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:   "push",
		Short: "Submit a new job from a JSON config file",
		Long: `Submit a new job by reading a JSON request body from a file.

Use "--file -" to read from stdin (handy in pipelines).

Examples:
  ohctl job push --file ./job.json
  cat job.json | ohctl job push --file -`,
		RunE: func(cmd *cobra.Command, args []string) error {
			data, err := readFileOrStdin(file)
			if err != nil {
				return err
			}
			var payload map[string]any
			if err := json.Unmarshal(data, &payload); err != nil {
				return fmt.Errorf("invalid JSON in %q: %w", file, err)
			}
			client := newAPIClient(opts)
			body, err := client.do(cmd.Context(), http.MethodPost, "/v1/jobs", payload)
			if err != nil {
				return err
			}
			return renderRawResponse(cmd.OutOrStdout(), opts, body)
		},
	}
	cmd.Flags().StringVarP(&file, "file", "f", "",
		`Path to JSON config (use "-" for stdin)`)
	_ = cmd.MarkFlagRequired("file")
	return cmd
}

// ---------------------------------------------------------------------------
// job list
// ---------------------------------------------------------------------------

func newJobListCmd(opts *rootOptions) *cobra.Command {
	var (
		status      string
		requestedBy string
		limit       int
		offset      int
	)
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List jobs",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			q := url.Values{}
			if status != "" {
				q.Set("status", status)
			}
			if requestedBy != "" {
				q.Set("requestedBy", requestedBy)
			}
			q.Set("limit", strconv.Itoa(limit))
			q.Set("offset", strconv.Itoa(offset))

			client := newAPIClient(opts)
			body, err := client.do(cmd.Context(), http.MethodGet, "/v1/jobs?"+q.Encode(), nil)
			if err != nil {
				return err
			}
			return renderRawResponse(cmd.OutOrStdout(), opts, body)
		},
	}
	cmd.Flags().StringVar(&status, "status", "",
		"Filter by status: queued|running|completed|failed|cancelled")
	cmd.Flags().StringVar(&requestedBy, "requestedBy", "", "Filter by requester")
	cmd.Flags().IntVar(&limit, "limit", 20, "Max items per page")
	cmd.Flags().IntVar(&offset, "offset", 0, "Pagination offset")
	return cmd
}

// ---------------------------------------------------------------------------
// job status / logs / sync / cancel / checkpoints / artifacts
// ---------------------------------------------------------------------------

func newJobStatusCmd(opts *rootOptions) *cobra.Command {
	return jobIDCommand(opts, jobIDCommandSpec{
		use:    "status [job-id]",
		short:  "Show full job status",
		method: http.MethodGet,
		path: func(id string) string {
			return "/v1/jobs/" + id
		},
	})
}

func newJobSyncCmd(opts *rootOptions) *cobra.Command {
	return jobIDCommand(opts, jobIDCommandSpec{
		use:    "sync [job-id]",
		short:  "Force the control plane to sync job state with the scheduler",
		method: http.MethodPost,
		path: func(id string) string {
			return "/v1/jobs/" + id + "/sync"
		},
	})
}

func newJobCancelCmd(opts *rootOptions) *cobra.Command {
	return jobIDCommand(opts, jobIDCommandSpec{
		use:    "cancel [job-id]",
		short:  "Request job cancellation",
		method: http.MethodPost,
		path: func(id string) string {
			return "/v1/jobs/" + id + "/cancel"
		},
	})
}

func newJobCheckpointsCmd(opts *rootOptions) *cobra.Command {
	return jobIDCommand(opts, jobIDCommandSpec{
		use:    "checkpoints [job-id]",
		short:  "List checkpoints recorded for a job",
		method: http.MethodGet,
		path: func(id string) string {
			return "/v1/jobs/" + id + "/checkpoints"
		},
	})
}

func newJobArtifactsCmd(opts *rootOptions) *cobra.Command {
	return jobIDCommand(opts, jobIDCommandSpec{
		use:    "artifacts [job-id]",
		short:  "List artifacts produced by a job",
		method: http.MethodGet,
		path: func(id string) string {
			return "/v1/jobs/" + id + "/artifacts"
		},
	})
}

func newJobLogsCmd(opts *rootOptions) *cobra.Command {
	var (
		jobID string
		tail  int
		since string
	)
	cmd := &cobra.Command{
		Use:   "logs [job-id]",
		Short: "Fetch recent log output for a job",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := resolveJobID(jobID, args)
			if err != nil {
				return err
			}
			q := url.Values{}
			q.Set("tail", strconv.Itoa(tail))
			if since != "" {
				q.Set("since", since)
			}
			client := newAPIClient(opts)
			body, err := client.do(cmd.Context(), http.MethodGet, "/v1/jobs/"+id+"/logs?"+q.Encode(), nil)
			if err != nil {
				return err
			}
			return renderRawResponse(cmd.OutOrStdout(), opts, body)
		},
	}
	cmd.Flags().StringVar(&jobID, "job-id", "", "Job ID (alternative to positional arg)")
	cmd.Flags().IntVar(&tail, "tail", 200, "Number of trailing log lines to return")
	cmd.Flags().StringVar(&since, "since", "", "Return logs newer than this RFC3339 timestamp")
	return cmd
}

// ---------------------------------------------------------------------------
// job resume
// ---------------------------------------------------------------------------

func newJobResumeCmd(opts *rootOptions) *cobra.Command {
	var (
		jobID       string
		checkpoint  string
		requestedBy string
	)
	cmd := &cobra.Command{
		Use:   "resume [job-id]",
		Short: "Resume a job from a checkpoint",
		Long: `Resume creates a new job seeded from a previous job's checkpoint.

The checkpoint reference may be either a checkpoint ID (e.g. ohk_abc123)
or a step alias (e.g. step-1000).`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := resolveJobID(jobID, args)
			if err != nil {
				return err
			}
			if checkpoint == "" {
				return errors.New("--checkpoint is required")
			}
			payload := map[string]any{
				"checkpoint":  checkpoint,
				"requestedBy": requestedBy,
			}
			client := newAPIClient(opts)
			body, err := client.do(cmd.Context(), http.MethodPost, "/v1/jobs/"+id+"/resume", payload)
			if err != nil {
				return err
			}
			return renderRawResponse(cmd.OutOrStdout(), opts, body)
		},
	}
	cmd.Flags().StringVar(&jobID, "job-id", "", "Job ID (alternative to positional arg)")
	cmd.Flags().StringVar(&checkpoint, "checkpoint", "", "Checkpoint ref (id or step-N)")
	cmd.Flags().StringVar(&requestedBy, "requestedBy", "", "Override requester for the resumed job")
	_ = cmd.MarkFlagRequired("checkpoint")
	return cmd
}

// ---------------------------------------------------------------------------
// job artifact get
// ---------------------------------------------------------------------------

func newJobArtifactCmd(opts *rootOptions) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "artifact",
		Short: "Inspect job artifacts",
	}
	cmd.AddCommand(&cobra.Command{
		Use:   "get <job-id> <artifact-id>",
		Short: "Fetch an artifact download URL",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			jobID, artifactID := args[0], args[1]
			client := newAPIClient(opts)
			body, err := client.do(cmd.Context(), http.MethodGet,
				"/v1/jobs/"+jobID+"/artifacts/"+artifactID+"/download", nil)
			if err != nil {
				return err
			}
			return renderRawResponse(cmd.OutOrStdout(), opts, body)
		},
	})
	return cmd
}

// ---------------------------------------------------------------------------
// job watch (new)
// ---------------------------------------------------------------------------

func newJobWatchCmd(opts *rootOptions) *cobra.Command {
	var (
		jobID    string
		interval time.Duration
	)
	cmd := &cobra.Command{
		Use:   "watch [job-id]",
		Short: "Poll a job's status until it reaches a terminal state",
		Long: `watch polls /v1/jobs/<id> on the configured interval and
prints a single line every time the status changes. When the job
reaches a terminal state (completed|failed|cancelled), it prints the
final status payload and exits.

Examples:
  ohctl job watch ohj_123
  ohctl job watch ohj_123 --interval 5s
  ohctl job watch ohj_123 --output yaml`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := resolveJobID(jobID, args)
			if err != nil {
				return err
			}
			if interval <= 0 {
				return errors.New("--interval must be > 0")
			}
			return watchJob(cmd.Context(), cmd.OutOrStdout(), opts, id, interval)
		},
	}
	cmd.Flags().StringVar(&jobID, "job-id", "", "Job ID (alternative to positional arg)")
	cmd.Flags().DurationVar(&interval, "interval", 3*time.Second, "Poll interval (e.g. 2s, 30s)")
	return cmd
}

func watchJob(ctx context.Context, w io.Writer, opts *rootOptions, jobID string, interval time.Duration) error {
	client := newAPIClient(opts)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	lastStatus := ""
	for {
		body, err := client.do(ctx, http.MethodGet, "/v1/jobs/"+jobID, nil)
		if err != nil {
			return err
		}
		var parsed struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		}
		if err := json.Unmarshal(body, &parsed); err == nil {
			if parsed.Status != lastStatus {
				fmt.Fprintf(w, "[%s] %s status=%s\n",
					time.Now().UTC().Format(time.RFC3339), jobID, parsed.Status)
				lastStatus = parsed.Status
			}
			if isTerminalStatus(parsed.Status) {
				return renderRawResponse(w, opts, body)
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func isTerminalStatus(s string) bool {
	switch s {
	case "completed", "failed", "cancelled":
		return true
	}
	return false
}

// ---------------------------------------------------------------------------
// shared helpers for job <verb> [job-id] commands
// ---------------------------------------------------------------------------

// jobIDCommandSpec describes a simple "take a job id, hit one endpoint"
// command. Most `job` verbs collapse to this shape.
type jobIDCommandSpec struct {
	use    string
	short  string
	method string
	path   func(jobID string) string
}

func jobIDCommand(opts *rootOptions, spec jobIDCommandSpec) *cobra.Command {
	var jobID string
	cmd := &cobra.Command{
		Use:   spec.use,
		Short: spec.short,
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := resolveJobID(jobID, args)
			if err != nil {
				return err
			}
			client := newAPIClient(opts)
			body, err := client.do(cmd.Context(), spec.method, spec.path(id), nil)
			if err != nil {
				return err
			}
			return renderRawResponse(cmd.OutOrStdout(), opts, body)
		},
	}
	cmd.Flags().StringVar(&jobID, "job-id", "", "Job ID (alternative to positional arg)")
	return cmd
}

// resolveJobID prefers the --job-id flag but accepts the first positional
// argument as a convenience: `ohctl job status ohj_123`.
func resolveJobID(flagValue string, args []string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	if len(args) > 0 && args[0] != "" {
		return args[0], nil
	}
	return "", errors.New(`job id is required (use the positional argument or --job-id)`)
}

func readFileOrStdin(path string) ([]byte, error) {
	if path == "" {
		return nil, errors.New(`--file is required (use "-" for stdin)`)
	}
	if path == "-" {
		return io.ReadAll(os.Stdin)
	}
	return os.ReadFile(path)
}
