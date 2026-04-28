package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
)

func Run(args []string) error {
	if len(args) == 0 {
		printUsage()
		return nil
	}

	switch args[0] {
	case "job":
		return runJob(args[1:])
	case "deploy":
		return runDeploy(args[1:])
	case "endpoints":
		return runEndpoints(args[1:])
	default:
		printUsage()
		return nil
	}
}

func printUsage() {
	fmt.Println(`ohctl commands:
  job push --file <config.json>
  job list [--status <status>] [--requestedBy <user>] [--limit 20] [--offset 0]
  job status <job-id>
  job logs <job-id> [--tail 200] [--since <iso>]
  job sync <job-id>
  job cancel <job-id>
  job checkpoints <job-id>
  job resume <job-id> --checkpoint <step-1000|checkpoint-id> [--requestedBy <user>]
  deploy --job-id <id> --checkpoint <step-1000|checkpoint-id> [--backend vllm|triton] [--gpu 1]
  endpoints list [--status <status>] [--limit 20] [--offset 0]

Compatibility:
  You can still use --job-id for all job commands.`)
}

func apiBaseURL() string {
	if value := os.Getenv("OHFORGE_API_BASE_URL"); value != "" {
		return value
	}
	return "http://localhost:8080"
}

func apiKey() string {
	if value := os.Getenv("OHCTL_API_KEY"); value != "" {
		return value
	}
	return ""
}

func doRequest(method string, path string, body any) error {
	var payload io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, apiBaseURL()+path, payload)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if key := apiKey(); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d %s: %s", resp.StatusCode, path, string(data))
	}

	var out bytes.Buffer
	if err := json.Indent(&out, data, "", "  "); err != nil {
		_, _ = os.Stdout.Write(data)
		_, _ = os.Stdout.Write([]byte("\n"))
		return nil
	}
	_, _ = os.Stdout.Write(out.Bytes())
	_, _ = os.Stdout.Write([]byte("\n"))
	return nil
}

func runJob(args []string) error {
	if len(args) == 0 {
		printUsage()
		return nil
	}
	switch args[0] {
	case "push":
		fs := flag.NewFlagSet("job push", flag.ContinueOnError)
		file := fs.String("file", "", "path to config JSON")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if *file == "" {
			return errors.New("--file is required")
		}
		data, err := os.ReadFile(*file)
		if err != nil {
			return err
		}
		var payload map[string]any
		if err := json.Unmarshal(data, &payload); err != nil {
			return err
		}
		return doRequest(http.MethodPost, "/v1/jobs", payload)
	case "list":
		fs := flag.NewFlagSet("job list", flag.ContinueOnError)
		status := fs.String("status", "", "job status filter")
		requestedBy := fs.String("requestedBy", "", "requester filter")
		limit := fs.Int("limit", 20, "page size")
		offset := fs.Int("offset", 0, "page offset")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		q := url.Values{}
		if *status != "" {
			q.Set("status", *status)
		}
		if *requestedBy != "" {
			q.Set("requestedBy", *requestedBy)
		}
		q.Set("limit", strconv.Itoa(*limit))
		q.Set("offset", strconv.Itoa(*offset))
		return doRequest(http.MethodGet, "/v1/jobs?"+q.Encode(), nil)
	case "status", "logs", "sync", "cancel", "checkpoints", "resume":
		return runJobWithID(args)
	default:
		printUsage()
		return nil
	}
}

func runJobWithID(args []string) error {
	sub := args[0]
	fs := flag.NewFlagSet("job "+sub, flag.ContinueOnError)
	jobID := fs.String("job-id", "", "job id")
	tail := fs.Int("tail", 200, "tail line count")
	since := fs.String("since", "", "timestamp filter")
	checkpoint := fs.String("checkpoint", "", "checkpoint ref")
	requestedBy := fs.String("requestedBy", "", "resume requester")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}

	// Short form support:
	// ohctl job status <job-id>
	// If --job-id is not provided, we accept the first positional argument.
	parsedArgs := fs.Args()
	if *jobID == "" && len(parsedArgs) > 0 {
		*jobID = parsedArgs[0]
	}
	if *jobID == "" {
		return errors.New("--job-id is required")
	}

	switch sub {
	case "status":
		return doRequest(http.MethodGet, "/v1/jobs/"+*jobID, nil)
	case "logs":
		q := url.Values{}
		q.Set("tail", strconv.Itoa(*tail))
		if *since != "" {
			q.Set("since", *since)
		}
		return doRequest(http.MethodGet, "/v1/jobs/"+*jobID+"/logs?"+q.Encode(), nil)
	case "sync":
		return doRequest(http.MethodPost, "/v1/jobs/"+*jobID+"/sync", nil)
	case "cancel":
		return doRequest(http.MethodPost, "/v1/jobs/"+*jobID+"/cancel", nil)
	case "checkpoints":
		return doRequest(http.MethodGet, "/v1/jobs/"+*jobID+"/checkpoints", nil)
	case "resume":
		if *checkpoint == "" {
			return errors.New("--checkpoint is required")
		}
		return doRequest(http.MethodPost, "/v1/jobs/"+*jobID+"/resume", map[string]any{
			"checkpoint":  *checkpoint,
			"requestedBy": *requestedBy,
		})
	default:
		return nil
	}
}

func runDeploy(args []string) error {
	fs := flag.NewFlagSet("deploy", flag.ContinueOnError)
	jobID := fs.String("job-id", "", "job id")
	checkpoint := fs.String("checkpoint", "", "checkpoint ref")
	backend := fs.String("backend", "vllm", "backend")
	gpu := fs.Int("gpu", 1, "gpu allocation")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *jobID == "" || *checkpoint == "" {
		return errors.New("--job-id and --checkpoint are required")
	}
	return doRequest(http.MethodPost, "/v1/deployments", map[string]any{
		"jobId":         *jobID,
		"checkpoint":    *checkpoint,
		"backend":       *backend,
		"gpuAllocation": *gpu,
	})
}

func runEndpoints(args []string) error {
	if len(args) == 0 || args[0] != "list" {
		printUsage()
		return nil
	}
	fs := flag.NewFlagSet("endpoints list", flag.ContinueOnError)
	status := fs.String("status", "", "endpoint status")
	limit := fs.Int("limit", 20, "page size")
	offset := fs.Int("offset", 0, "page offset")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	q := url.Values{}
	if *status != "" {
		q.Set("status", *status)
	}
	q.Set("limit", strconv.Itoa(*limit))
	q.Set("offset", strconv.Itoa(*offset))
	return doRequest(http.MethodGet, "/v1/endpoints?"+q.Encode(), nil)
}
