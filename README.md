# BrowserAutoDrive

AI-powered browser automation platform. Extension-first. CLI stays as support harness and eval runner.

## Quick Start

```bash
# Set up development environment
make setup

# Run tests
make test

# Run linting
make lint

# Build CLI / workspace
make build

# Run the CLI
npx browserautodrive --help
```

## CLI Usage

```bash
# Show version
npx browserautodrive --version

# Run browser automation
npx browserautodrive run https://example.com

# Record a session
npx browserautodrive record https://example.com -o recording.json

# Run evaluations
npx browserautodrive eval --reporter json
```

## Extension Direction

The Chrome extension is the primary product surface.

- popup drives goal entry
- background service worker owns execution
- content scripts observe and act on the page
- storage backs session recovery after MV3 suspension

## Project Structure

```
browserautodrive/
├── packages/
│   ├── cli/          # Command line interface
│   ├── browser/      # Browser control engine
│   └── eval/         # Evaluation and test suite
├── turbo.json        # Turborepo configuration
└── package.json      # Root workspace config
```

## CI/CD

Pushes to `main` and PRs trigger the CI pipeline automatically.
See `.github/workflows/ci.yml` for pipeline configuration.

## Release Process

1. Bump version in `VERSION`
2. Update `CHANGELOG.md`
3. Create a release PR
4. Merge to main to trigger release workflow

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `make test`
4. Submit a pull request
