# BountyMesh — local-only build/test/IDL-drift commands.
# No git, no deploy, no network beyond cargo registry. See CLAUDE.md.

PROGRAM_DIR := programs/bountymesh
IDL_BUILT   := $(PROGRAM_DIR)/target/wasm32-gear/release/bountymesh.idl
IDL_SNAP    := agent-starter/idl/bountymesh.idl.snapshot

.PHONY: build
build:
	cd $(PROGRAM_DIR) && cargo build --release

.PHONY: test
test:
	cd $(PROGRAM_DIR) && cargo test --release

.PHONY: snapshot-idl
snapshot-idl: build
	@cp $(IDL_BUILT) $(IDL_SNAP)
	@echo "IDL snapshot updated: $(IDL_SNAP)"
	@echo "Last blessed: $$(date -u +%Y-%m-%dT%H:%M:%SZ)"

.PHONY: check-idl-drift
check-idl-drift: build
	@if [ ! -f $(IDL_SNAP) ]; then \
	  echo "ERROR: no snapshot at $(IDL_SNAP) — run 'make snapshot-idl' first."; exit 2; \
	fi
	@if diff -u $(IDL_SNAP) $(IDL_BUILT) > /dev/null; then \
	  echo "IDL: in sync with snapshot."; \
	else \
	  echo "IDL DRIFT — built IDL differs from snapshot:"; \
	  diff -u $(IDL_SNAP) $(IDL_BUILT) || true; \
	  echo ""; \
	  echo "If the change is intentional: run 'make snapshot-idl'."; \
	  echo "Otherwise: investigate before any deploy or SDK regen."; \
	  exit 1; \
	fi

.PHONY: clean
clean:
	cd $(PROGRAM_DIR) && cargo clean

# Phase 2 — SDK targets. All operate inside packages/sdk/.
SDK_DIR := packages/sdk

.PHONY: sdk-codegen
sdk-codegen:
	cd $(SDK_DIR) && npm run generate-client && npm run generate-errors

.PHONY: sdk-check-codegen-drift
sdk-check-codegen-drift:
	cd $(SDK_DIR) && npm run check-codegen-drift

.PHONY: sdk-test
sdk-test:
	cd $(SDK_DIR) && npm run test

.PHONY: sdk-build
sdk-build:
	cd $(SDK_DIR) && npm run build

.PHONY: sdk-dry-publish
sdk-dry-publish:
	cd $(SDK_DIR) && npm publish --dry-run

.PHONY: sdk-check-name
sdk-check-name:
	@out=$$(npm view @bountymesh/sdk 2>&1); \
	if echo "$$out" | grep -q "E404"; then \
	  echo "name @bountymesh/sdk: AVAILABLE (404)"; \
	else \
	  echo "WARNING: name may be taken:"; echo "$$out"; exit 1; \
	fi

# Phase 3 — indexer targets. All operate inside services/indexer/.
INDEXER_DIR := services/indexer

.PHONY: indexer-install
indexer-install:
	cd $(INDEXER_DIR) && npm install --legacy-peer-deps

# downstream consumers read SDK via dist/; refresh before rebuilding
.PHONY: indexer-build
indexer-build: sdk-build
	cd $(INDEXER_DIR) && npm run build

.PHONY: indexer-db-up
indexer-db-up:
	cd $(INDEXER_DIR) && npm run db:up

.PHONY: indexer-db-down
indexer-db-down:
	cd $(INDEXER_DIR) && npm run db:down

.PHONY: indexer-db-reset
indexer-db-reset:
	cd $(INDEXER_DIR) && npm run db:reset

.PHONY: indexer-db-generate
indexer-db-generate:
	cd $(INDEXER_DIR) && npm run db:generate

.PHONY: indexer-db-migrate
indexer-db-migrate:
	cd $(INDEXER_DIR) && npm run db:migrate

.PHONY: indexer-db-check-drift
indexer-db-check-drift:
	cd $(INDEXER_DIR) && npm run db:check-drift

.PHONY: indexer-start
indexer-start:
	cd $(INDEXER_DIR) && npm start

.PHONY: indexer-test
indexer-test:
	cd $(INDEXER_DIR) && npm run test:integration

# Phase 4 — worker targets. All operate inside services/worker/.
WORKER_DIR := services/worker

.PHONY: worker-install
worker-install:
	cd $(WORKER_DIR) && npm install --legacy-peer-deps

.PHONY: worker-build
worker-build: sdk-build
	cd $(WORKER_DIR) && npm run build

.PHONY: worker-start
worker-start:
	cd $(WORKER_DIR) && npm start

.PHONY: worker-build-clean
worker-build-clean:
	cd $(WORKER_DIR) && rm -rf dist node_modules
