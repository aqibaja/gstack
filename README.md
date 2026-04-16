# GStack

GStack project infrastructure.

## Quick Start

```bash
# Set up development environment
make setup

# Run tests
make test

# Run linting
make lint

# Build release
make release
```

## CI/CD

Pushes to `main` and PRs trigger the CI pipeline automatically.
See `.github/workflows/ci.yml` for pipeline configuration.

## Release Process

1. Bump version in `VERSION`
2. Update `CHANGELOG.md`
3. Create a release PR
4. Merge to main to trigger release workflow
