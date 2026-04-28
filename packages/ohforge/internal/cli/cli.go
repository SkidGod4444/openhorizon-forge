// Package cli implements the `ohctl` command-line interface.
//
// The package is organized into a few small files so contributors can
// jump straight to the area they want to change:
//
//   - cli.go      : entrypoint, root command, persistent flags
//   - job.go      : `ohctl job ...` subcommands
//   - version.go  : `ohctl version`
//   - client.go   : HTTP client used to talk to the control plane
//   - output.go   : json / table / yaml rendering and helpers
package cli

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"
)

// Version, Commit, and BuildDate are injected at build/release time via
// -ldflags. Defaults are used for local `go run` builds.
var (
	Version   = "dev"
	Commit    = "none"
	BuildDate = "unknown"
)

// rootOptions captures global flags shared by every subcommand.
// Subcommands receive a pointer so they always see the resolved value
// after cobra parses the CLI arguments.
type rootOptions struct {
	apiBaseURL string
	apiKey     string
	output     string
	timeout    time.Duration
}

// Run is the public entrypoint used by cmd/ohctl/main.go.
// It wires SIGINT/SIGTERM into a context so long-running commands
// (e.g. `ohctl job watch`) can shut down cleanly.
func Run(args []string) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	root := newRootCmd()
	root.SetArgs(args)

	if err := root.ExecuteContext(ctx); err != nil {
		if errors.Is(err, context.Canceled) {
			return errors.New("cancelled")
		}
		return err
	}
	return nil
}

func newRootCmd() *cobra.Command {
	opts := &rootOptions{}

	cmd := &cobra.Command{
		Use:   "ohctl",
		Short: "Control plane CLI for OpenHorizon Forge",
		Long: `ohctl is the official CLI for OpenHorizon Forge.

It talks to the control-plane HTTP API to submit, inspect, and manage
training jobs running on the OpenHorizon scheduler.

Configuration precedence (highest first):
  1. CLI flag             e.g. --api-base-url
  2. Environment variable e.g. OHCTL_API_BASE_URL
  3. Built-in default     http://localhost:8080`,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	pf := cmd.PersistentFlags()
	pf.StringVar(&opts.apiBaseURL, "api-base-url", "",
		"Control plane base URL (env OHCTL_API_BASE_URL, default http://localhost:8080)")
	pf.StringVar(&opts.apiKey, "api-key", "",
		"Bearer token for the control plane (env OHCTL_API_KEY)")
	pf.StringVarP(&opts.output, "output", "o", "",
		"Output format: json|table|yaml (env OHCTL_OUTPUT, default json)")
	pf.DurationVar(&opts.timeout, "timeout", 30*time.Second,
		"HTTP request timeout (e.g. 5s, 1m)")

	cmd.AddCommand(
		newJobCmd(opts),
		newVersionCmd(opts),
	)

	cmd.SetUsageTemplate(usageTemplate)
	return cmd
}

// usageTemplate is a slightly trimmed version of cobra's default
// template that puts `Examples` above `Available Commands` so the
// most useful information stays at the top.
const usageTemplate = `Usage:{{if .Runnable}}
  {{.UseLine}}{{end}}{{if .HasAvailableSubCommands}}
  {{.CommandPath}} [command]{{end}}{{if gt (len .Aliases) 0}}

Aliases:
  {{.NameAndAliases}}{{end}}{{if .HasExample}}

Examples:
{{.Example}}{{end}}{{if .HasAvailableSubCommands}}{{$cmds := .Commands}}{{if eq (len .Groups) 0}}

Available Commands:{{range $cmds}}{{if (or .IsAvailableCommand (eq .Name "help"))}}
  {{rpad .Name .NamePadding }} {{.Short}}{{end}}{{end}}{{else}}{{range $group := .Groups}}

{{.Title}}{{range $cmds}}{{if (and (eq .GroupID $group.ID) (or .IsAvailableCommand (eq .Name "help")))}}
  {{rpad .Name .NamePadding }} {{.Short}}{{end}}{{end}}{{end}}{{end}}{{end}}{{if .HasAvailableLocalFlags}}

Flags:
{{.LocalFlags.FlagUsages | trimTrailingWhitespaces}}{{end}}{{if .HasAvailableInheritedFlags}}

Global Flags:
{{.InheritedFlags.FlagUsages | trimTrailingWhitespaces}}{{end}}{{if .HasHelpSubCommands}}

Additional help topics:{{range .Commands}}{{if .IsAdditionalHelpTopicCommand}}
  {{rpad .CommandPath .CommandPathPadding}} {{.Short}}{{end}}{{end}}{{end}}{{if .HasAvailableSubCommands}}

Use "{{.CommandPath}} [command] --help" for more information about a command.{{end}}
`

// firstNonEmpty returns the first non-empty string from values.
// Used to apply the "flag > env > default" precedence rule.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
