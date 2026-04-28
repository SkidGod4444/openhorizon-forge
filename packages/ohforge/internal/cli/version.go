package cli

import "github.com/spf13/cobra"

func newVersionCmd(opts *rootOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print ohctl version, commit, and build date",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			payload := map[string]string{
				"version":   Version,
				"commit":    Commit,
				"buildDate": BuildDate,
			}
			return renderValue(cmd.OutOrStdout(), opts, payload)
		},
	}
}
