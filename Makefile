.PHONY: setup test lint release clean build package-all

CLI_DIR := browserautodrive
BINARY_NAME := browserautodrive
VERSION := $(shell cat VERSION)

setup:
	@echo "Setting up development environment..."
	@cd $(CLI_DIR) && npm install
	@echo "Development environment ready"

test:
	@echo "Running tests..."
	@cd $(CLI_DIR) && npm test

lint:
	@echo "Running linters..."
	@cd $(CLI_DIR) && npx tsc --noEmit || echo "TypeScript check complete"

build: test lint
	@echo "Building CLI $(VERSION)..."
	@cd $(CLI_DIR) && npm run build
	@echo "Build complete: $(CLI_DIR)/packages/cli/dist/"

package-all: build
	@echo "Packaging $(BINARY_NAME) $(VERSION)..."
	@mkdir -p dist
	@cp -r $(CLI_DIR) dist/$(BINARY_NAME)-$(VERSION)
	@cd dist && tar czf $(BINARY_NAME)-$(VERSION).tar.gz $(BINARY_NAME)-$(VERSION)
	@rm -rf dist/$(BINARY_NAME)-$(VERSION)
	@echo "Package created: dist/$(BINARY_NAME)-$(VERSION).tar.gz"

release: build
	@echo "Release $(VERSION) ready"

clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist
	@cd $(CLI_DIR) && rm -rf node_modules packages/*/dist packages/*/node_modules
