# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-04-21

### Added
- Extension Jest harness for popup/runtime and background message-router coverage
- New popup runtime test suite with chrome API mocks and setup wiring

### Changed
- Message router validation now returns explicit `VALIDATION_ERROR` responses for malformed messages
- Shared extension message contracts now include compatibility message variants used by validator flow

## [0.4.0] - 2026-04-19

### Added
- Esbuild-based multi-entry Chrome extension build pipeline with manifest, popup assets, and generated icon staging
- Extension-specific `make build-extension` and `make check-extension` targets
- Dedicated CI extension build job with uploaded unpacked-extension artifacts

### Changed
- Extension package scripts now use `tsc --noEmit` for type checking and `build.mjs` for artifact generation
- Root lint target now runs the workspace lint pipeline instead of a no-op compiler invocation

## [0.3.0] - 2026-04-19

### Added
- Chrome extension popup foundation with goal entry, step preview cards, and confirm/skip controls
- Free vs pro popup experience with auto-execute preference handling
- Extension build packaging script for manifest and static popup assets

### Changed
- Extension service worker and shared message contracts to support popup-driven preview flow
- Workspace lockfile to include the extension's `@types/chrome` dependency

## [0.2.0] - 2026-04-16

### Added
- CLI binary with version and help commands
- Multi-platform build support (darwin, linux, windows / amd64, arm64)
- Automated packaging into tar.gz and zip archives
- Go module setup for CLI development
- CI workflow with build artifact upload
- Release workflow with automated GitHub release creation

### Changed
- Makefile with build, package-all, and release targets
- CI pipeline with Go toolchain and artifact handling
