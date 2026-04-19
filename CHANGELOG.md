# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
