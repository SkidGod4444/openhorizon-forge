package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type outputFormat string

const (
	outputJSON  outputFormat = "json"
	outputTable outputFormat = "table"
	outputYAML  outputFormat = "yaml"
)

// resolveOutput honours flag > env > default precedence.
// Unknown values fall back to JSON to keep the CLI predictable
// when piped into automation.
func resolveOutput(opts *rootOptions) outputFormat {
	value := opts.output
	if value == "" {
		value = os.Getenv("OHCTL_OUTPUT")
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "table":
		return outputTable
	case "yaml", "yml":
		return outputYAML
	default:
		return outputJSON
	}
}

// renderRawResponse prints an HTTP response body using the active
// output format. When the user requests `table` but the payload isn't
// tabular, it transparently falls back to indented JSON so the user
// always sees something useful.
func renderRawResponse(w io.Writer, opts *rootOptions, data []byte) error {
	switch resolveOutput(opts) {
	case outputYAML:
		var generic any
		if err := json.Unmarshal(data, &generic); err != nil {
			_, err := w.Write(append(data, '\n'))
			return err
		}
		return writeYAML(w, generic)
	case outputTable:
		var generic any
		if err := json.Unmarshal(data, &generic); err == nil {
			if rendered := renderTable(generic); rendered != "" {
				_, err := fmt.Fprintln(w, rendered)
				return err
			}
		}
		// Not tabular, fall back to JSON.
		return writeIndentedJSON(w, data)
	default:
		return writeIndentedJSON(w, data)
	}
}

// renderValue prints any Go value using the active output format.
// Used by commands like `version` that build their payload locally.
func renderValue(w io.Writer, opts *rootOptions, payload any) error {
	switch resolveOutput(opts) {
	case outputYAML:
		return writeYAML(w, payload)
	case outputTable:
		if rendered := renderTable(payload); rendered != "" {
			_, err := fmt.Fprintln(w, rendered)
			return err
		}
		fallthrough
	default:
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(payload)
	}
}

func writeYAML(w io.Writer, payload any) error {
	enc := yaml.NewEncoder(w)
	enc.SetIndent(2)
	if err := enc.Encode(payload); err != nil {
		return err
	}
	return enc.Close()
}

func writeIndentedJSON(w io.Writer, data []byte) error {
	var indented bytes.Buffer
	if err := json.Indent(&indented, data, "", "  "); err == nil {
		indented.WriteByte('\n')
		_, err := w.Write(indented.Bytes())
		return err
	}
	_, err := w.Write(append(data, '\n'))
	return err
}

// renderTable returns a plain-text aligned table for either:
//   - a paginated payload `{"items":[{...}]}` (the common shape)
//   - a top-level array `[{...}]`
//
// It returns "" when the payload is not tabular so callers can fall
// back to JSON or YAML.
func renderTable(payload any) string {
	var items []any
	switch v := payload.(type) {
	case map[string]any:
		raw, ok := v["items"]
		if !ok {
			return ""
		}
		arr, ok := raw.([]any)
		if !ok {
			return ""
		}
		items = arr
	case []any:
		items = v
	default:
		return ""
	}

	if len(items) == 0 {
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
		for k, val := range obj {
			row[k] = formatCell(val)
			keySet[k] = struct{}{}
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return ""
	}

	keys := sortedKeys(keySet)
	preferred := []string{
		"id", "jobId", "name", "status", "requestedBy", "slurmJobId",
		"gpus", "nodes", "kind", "format", "sizeBytes", "createdAt", "updatedAt",
	}
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
	b.WriteByte('\n')
	for i, k := range keys {
		if i > 0 {
			b.WriteString("  ")
		}
		b.WriteString(strings.Repeat("-", width[k]))
	}
	b.WriteByte('\n')
	for _, row := range rows {
		for i, k := range keys {
			if i > 0 {
				b.WriteString("  ")
			}
			b.WriteString(padRight(row[k], width[k]))
		}
		b.WriteByte('\n')
	}
	return strings.TrimRight(b.String(), "\n")
}

func formatCell(v any) string {
	switch t := v.(type) {
	case nil:
		return "-"
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case float64:
		// json.Unmarshal decodes all numbers as float64. Keep integer
		// looking values free of decimals for nicer table output.
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	default:
		encoded, _ := json.Marshal(t)
		return string(encoded)
	}
}

func padRight(value string, n int) string {
	if len(value) >= n {
		return value
	}
	return value + strings.Repeat(" ", n-len(value))
}

func sortedKeys(set map[string]struct{}) []string {
	keys := make([]string, 0, len(set))
	for k := range set {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
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
	rest := sortedKeys(set)
	out = append(out, rest...)
	return out
}
