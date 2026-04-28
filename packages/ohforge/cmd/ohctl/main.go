// Package main is the entrypoint for the `ohctl` binary.
//
// This file is intentionally tiny: all command logic lives in
// internal/cli so contributors can find it quickly. Adding a new
// command happens in internal/cli, not here.
package main

import (
	"fmt"
	"os"

	"github.com/openhorizon/ohforge/internal/cli"
)

func main() {
	if err := cli.Run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err.Error())
		os.Exit(1)
	}
}
