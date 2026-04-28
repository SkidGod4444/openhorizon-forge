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
	"sort"
	"strconv"
	"strings"
)

var (
	// Version, Commit, and BuildDate are injected at build/release time.
	// Defaults are used for local dev builds.
	Version   = "dev"
	Commit    = "none"
	BuildDate = "unknown"
)

func Run(args []string) error {
	if len(args) == 0 {
		printUsage()
		return nil
	}

	switch args[0] {
	case "job":
		return runJob(args[1:])
	case "version":
		return runVersion()
	case "completion":
		return runCompletion(args[1:])
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
  job artifacts <job-id>
  job artifact get <job-id> <artifact-id>
  job resume <job-id> --checkpoint <step-1000|checkpoint-id> [--requestedBy <user>]
  version
  completion <bash|zsh|powershell>

Compatibility:
  You can still use --job-id for all job commands.`)
}

func apiBaseURL() string {
	if value := os.Getenv("OHCTL_API_BASE_URL"); value != "" {
		return value
	}
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

	if os.Getenv("OHCTL_OUTPUT") == "table" {
		if rendered := renderTable(data); rendered != "" {
			_, _ = os.Stdout.WriteString(rendered + "\n")
			return nil
		}
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
	case "status", "logs", "sync", "cancel", "checkpoints", "artifacts", "resume":
		return runJobWithID(args)
	case "artifact":
		return runJobArtifact(args[1:])
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
	case "artifacts":
		return doRequest(http.MethodGet, "/v1/jobs/"+*jobID+"/artifacts", nil)
	default:
		return nil
	}
}

func runJobArtifact(args []string) error {
	if len(args) < 3 || args[0] != "get" {
		return errors.New("usage: job artifact get <job-id> <artifact-id>")
	}
	jobID := args[1]
	artifactID := args[2]
	return doRequest(http.MethodGet, "/v1/jobs/"+jobID+"/artifacts/"+artifactID+"/download", nil)
}

func runVersion() error {
	out := map[string]string{
		"version":   Version,
		"commit":    Commit,
		"buildDate": BuildDate,
	}
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	_, _ = os.Stdout.Write(data)
	_, _ = os.Stdout.Write([]byte("\n"))
	return nil
}

func runCompletion(args []string) error {
	if len(args) < 1 {
		return errors.New("usage: completion <bash|zsh|powershell>")
	}
	switch args[0] {
	case "bash":
		fmt.Println(`_ohctl_completions() {
  local cur prev
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  local commands="job version completion"
  local job_subcommands="push list status logs sync cancel checkpoints artifacts artifact resume"
  local comp_subcommands="bash zsh powershell"
  if [[ ${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commands}" -- "${cur}") )
    return 0
  fi
  if [[ ${COMP_WORDS[1]} == "job" && ${COMP_CWORD} -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "${job_subcommands}" -- "${cur}") )
    return 0
  fi
  if [[ ${COMP_WORDS[1]} == "completion" && ${COMP_CWORD} -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "${comp_subcommands}" -- "${cur}") )
    return 0
  fi
}
complete -F _ohctl_completions ohctl`)
	case "zsh":
		fmt.Println(`#compdef ohctl
_ohctl() {
  local -a commands
  commands=(
    'job:job commands'
    'version:print version'
    'completion:print shell completion'
  )
  _arguments '1: :->cmds'
  case $state in
    cmds)
      _describe -t commands 'ohctl commands' commands
      ;;
  esac
}
_ohctl "$@"`)
	case "powershell":
		fmt.Println(`Register-ArgumentCompleter -CommandName ohctl -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = @("job","version","completion")
  $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, "ParameterValue", $_)
  }
}`)
	default:
		return errors.New("unknown shell; expected bash|zsh|powershell")
	}
	return nil
}

func renderTable(data []byte) string {
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return ""
	}
	root, ok := parsed.(map[string]any)
	if !ok {
		return ""
	}
	itemsRaw, ok := root["items"]
	if !ok {
		return ""
	}
	items, ok := itemsRaw.([]any)
	if !ok || len(items) == 0 {
		return "No items."
	}

	rows := make([]map[string]string, 0, len(items))
	keySet := map[string]struct{}{}
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		row := map[string]string{}
		for k, v := range obj {
			switch t := v.(type) {
			case string:
				row[k] = t
			case float64:
				row[k] = strconv.FormatFloat(t, 'f', -1, 64)
			case bool:
				row[k] = strconv.FormatBool(t)
			default:
				encoded, _ := json.Marshal(t)
				row[k] = string(encoded)
			}
			keySet[k] = struct{}{}
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return ""
	}

	keys := make([]string, 0, len(keySet))
	for k := range keySet {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	preferred := []string{"jobId", "status", "requestedBy", "slurmJobId", "gpus", "nodes", "id", "name", "kind", "format", "sizeBytes", "createdAt"}
	keys = sortColumns(keys, preferred)

	width := map[string]int{}
	for _, k := range keys {
		width[k] = len(k)
	}
	for _, row := range rows {
		for _, k := range keys {
			if l := len(row[k]); l > width[k] {
				width[k] = l
			}
		}
	}

	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteString("  ")
		}
		b.WriteString(padRight(k, width[k]))
	}
	b.WriteString("\n")
	for i, k := range keys {
		if i > 0 {
			b.WriteString("  ")
		}
		b.WriteString(strings.Repeat("-", width[k]))
	}
	b.WriteString("\n")
	for _, row := range rows {
		for i, k := range keys {
			if i > 0 {
				b.WriteString("  ")
			}
			b.WriteString(padRight(row[k], width[k]))
		}
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func padRight(value string, n int) string {
	if len(value) >= n {
		return value
	}
	return value + strings.Repeat(" ", n-len(value))
}

func sortColumns(keys []string, preferred []string) []string {
	set := map[string]struct{}{}
	for _, k := range keys {
		set[k] = struct{}{}
	}
	out := make([]string, 0, len(keys))
	for _, k := range preferred {
		if _, ok := set[k]; ok {
			out = append(out, k)
			delete(set, k)
		}
	}
	rest := make([]string, 0, len(set))
	for k := range set {
		rest = append(rest, k)
	}
	sort.Strings(rest)
	out = append(out, rest...)
	return out
}
