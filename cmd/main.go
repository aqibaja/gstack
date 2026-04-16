package main

import (
	"fmt"
	"os"
)

var (
	Version   = "dev"
	Commit    = "none"
	BuildTime = "unknown"
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version", "-v":
			printVersion()
			os.Exit(0)
		case "version":
			printVersion()
			os.Exit(0)
		case "--help", "-h":
			printHelp()
			os.Exit(0)
		default:
			fmt.Fprintf(os.Stderr, "Unknown command: %s\n", os.Args[1])
			os.Exit(1)
		}
	}
	printHelp()
}

func printVersion() {
	fmt.Printf("gstack %s (commit: %s, built: %s)\n", Version, Commit, BuildTime)
}

func printHelp() {
	fmt.Println("GStack CLI - Project infrastructure tool")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  gstack [command]")
	fmt.Println()
	fmt.Println("Commands:")
	fmt.Println("  version    Print version information")
	fmt.Println("  --help     Show this help message")
	fmt.Println("  --version  Print version information")
}
