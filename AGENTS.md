# GStack Agent Guidelines

## Project Structure
- `VERSION` - Current semantic version
- `CHANGELOG.md` - Release changelog
- `Makefile` - Developer commands
- `.github/workflows/ci.yml` - CI pipeline

## Commands
- `make setup` - Set up dev environment
- `make test` - Run tests
- `make lint` - Run linters
- `make release` - Build release

## Release Process
1. Bump VERSION
2. Update CHANGELOG.md
3. Create PR
4. Merge to trigger release workflow
