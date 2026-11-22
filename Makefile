# Physics Tooling — command-line entry points.
# Thin wrappers over the npm scripts in package.json, plus a few checks that
# have no npm script. Run `make` or `make help` for the list.

.DEFAULT_GOAL := help
SHELL := /bin/bash

NPM ?= npm
# A document to open with `make start`, e.g. make start FILE=~/orbit.physsim
FILE ?=
# A test file or name filter for `make test`, e.g. make test T=sensitivity
T ?=

# Installs when package-lock.json is newer than the last install.
node_modules: package-lock.json
	$(NPM) ci
	@touch node_modules

##@ Setup

.PHONY: install
install: ## Install dependencies exactly as locked
	$(NPM) ci
	@touch node_modules

.PHONY: doctor
doctor: ## Report which tools are present, including the optional export targets
	@echo "Required"
	@printf "  %-12s %s\n" node "$$(node --version 2>/dev/null || echo MISSING)"
	@printf "  %-12s %s\n" npm "$$($(NPM) --version 2>/dev/null || echo MISSING)"
	@printf "  %-12s %s\n" dependencies "$$([ -d node_modules ] && echo installed || echo 'MISSING - run: make install')"
	@echo "Optional (export tests skip themselves without these)"
	@printf "  %-12s %s\n" python3 "$$(python3 --version 2>/dev/null || echo missing)"
	@printf "  %-12s %s\n" scipy "$$(python3 -c 'import scipy, numpy; print(scipy.__version__)' 2>/dev/null || echo 'missing - Python export is not verified')"
	@printf "  %-12s %s\n" octave "$$(octave --version 2>/dev/null | head -1 || true)$$(command -v octave >/dev/null || echo 'missing - MATLAB/Octave export is not verified')"
	@echo "Optional (used only by Run and compare; no tests cover them)"
	@printf "  %-12s %s\n" julia "$$(julia --version 2>/dev/null || echo missing)"
	@printf "  %-12s %s\n" wolframscript "$$(command -v wolframscript 2>/dev/null || echo missing)"
	@printf "  %-12s %s\n" matlab "$$(command -v matlab 2>/dev/null || echo missing)"

##@ Run

.PHONY: dev
dev: node_modules ## Desktop app with hot reload
	$(NPM) run dev

.PHONY: start
start: build ## Production build, then launch it (FILE=path opens a document)
	npx electron . $(FILE)

.PHONY: web
web: node_modules ## UI only, in a browser (no file dialogs or external tools)
	$(NPM) run dev:web

##@ Check

.PHONY: test
test: node_modules ## Run the tests (T=name runs matching files only)
	npx vitest run $(T)

.PHONY: test-watch
test-watch: node_modules ## Re-run tests as files change (T=name to narrow)
	npx vitest $(T)

.PHONY: typecheck
typecheck: node_modules ## Type-check; vitest does not, so run this as well as the tests
	$(NPM) run typecheck

.PHONY: check
check: typecheck test ## Type-check and test: run before every commit

.PHONY: audit
audit: node_modules ## List known advisories in the dependencies
	-$(NPM) audit

##@ Build

.PHONY: build
build: node_modules ## Type-check and bundle into dist/
	$(NPM) run build

.PHONY: package
package: node_modules ## Unpacked app in release/ (fast packaging check)
	$(NPM) run dist:dir

.PHONY: dist
dist: node_modules ## Installer for this operating system, in release/
	$(NPM) run dist

##@ Housekeeping

.PHONY: version
version: ## Show the app version and the document file format
	@printf "app          %s\n" "$$(node -p "require('./package.json').version")"
	@printf "file format  %s\n" "$$(sed -n 's/^export const FILE_FORMAT = \([0-9]*\);.*/\1/p' src/version.ts)"

.PHONY: clean
clean: ## Remove build output (dist/, release/)
	rm -rf dist release

.PHONY: distclean
distclean: clean ## Also remove installed dependencies
	rm -rf node_modules

.PHONY: help
help: ## Show this list
	@awk 'BEGIN {FS = ":.*## "} \
		/^##@ / { printf "\n%s\n", substr($$0, 5); next } \
		/^[a-zA-Z_-]+:.*## / { printf "  make %-12s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf "\nOptions: FILE=path with start, T=name with test and test-watch.\n"
