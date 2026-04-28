package main

import (
	"os"

	"github.com/openhorizon/ohforge/internal/cli"
)

func main() {
	// Entrypoint only delegates to the CLI package.
	// Keeping this file tiny makes it easy for beginners to locate
	// "where execution starts" without mixing command logic here.
	if err := cli.Run(os.Args[1:]); err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}
