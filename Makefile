BUILDDIR := dist
BINARY_NAME := gstack
VERSION := $(shell cat VERSION)
COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME := $(shell date -u '+%Y-%m-%dT%H:%M:%SZ')

LDFLAGS := -ldflags "-s -w \
	-X main.Version=$(VERSION) \
	-X main.Commit=$(COMMIT) \
	-X main.BuildTime=$(BUILD_TIME)"

PLATFORMS := darwin-amd64 darwin-arm64 linux-amd64 linux-arm64 windows-amd64

.PHONY: setup test lint release clean build package-all

setup:
	@echo "Setting up development environment..."
	@go version || echo "Go is required for building the CLI"

test:
	@echo "Running tests..."
	@go test ./... -v

lint:
	@echo "Running linters..."
	@golangci-lint run ./... || echo "golangci-lint not installed, skipping"

build: test lint
	@echo "Building $(BINARY_NAME) $(VERSION)..."
	@mkdir -p $(BUILDDIR)
	@go build $(LDFLAGS) -o $(BUILDDIR)/$(BINARY_NAME) ./cmd/
	@echo "Binary built: $(BUILDDIR)/$(BINARY_NAME)"

package-all:
	@echo "Packaging $(BINARY_NAME) $(VERSION) for all platforms..."
	@mkdir -p $(BUILDDIR)
	@for platform in $(PLATFORMS); do \
		os=$${platform%-*}; \
		arch=$${platform#*-}; \
		ext=""; \
		if [ "$$os" = "windows" ]; then ext=".exe"; fi; \
		outfile="$(BUILDDIR)/$(BINARY_NAME)-$(VERSION)-$$os-$$arch$$ext"; \
		echo "Building $$os/$$arch..."; \
		GOOS=$$os GOARCH=$$arch go build $(LDFLAGS) -o "$$outfile" ./cmd/; \
		if [ "$$os" != "windows" ]; then \
			tar czf "$$outfile.tar.gz" -C $(BUILDDIR) "$$(basename $$outfile)"; \
			rm "$$outfile"; \
			echo "Packaged: $$outfile.tar.gz"; \
		else \
			zip "$$outfile.zip" "$$outfile"; \
			rm "$$outfile"; \
			echo "Packaged: $$outfile.zip"; \
		fi; \
	done
	@echo "All packages built in $(BUILDDIR)/"

release: build
	@echo "Release $(VERSION) ready"

clean:
	@echo "Cleaning build artifacts..."
	@rm -rf $(BUILDDIR)
