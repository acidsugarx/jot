SHELL := /bin/bash

APP_NAME := jot
ROOT_DIR := $(CURDIR)
TAURI_DIR := $(ROOT_DIR)/src-tauri
DIST_DIR := $(ROOT_DIR)/dist
RELEASE_DIR := $(TAURI_DIR)/target/release

UNAME_S := $(shell uname -s)
HOME_BIN := $(HOME)/.local/bin

ifeq ($(UNAME_S),Darwin)
PACKAGE_KIND := dmg
PACKAGE_OUTPUT := $(firstword $(wildcard $(RELEASE_DIR)/bundle/dmg/*.dmg))
LOCAL_INSTALL_DESC := Copy .app into /Applications
LOCAL_INSTALL_CMD = \
	if [ ! -d "$(RELEASE_DIR)/bundle/macos/$(APP_NAME).app" ]; then \
		echo "Missing app bundle at $(RELEASE_DIR)/bundle/macos/$(APP_NAME).app"; \
		exit 1; \
	fi; \
	rm -rf "/Applications/$(APP_NAME).app"; \
	cp -R "$(RELEASE_DIR)/bundle/macos/$(APP_NAME).app" "/Applications/$(APP_NAME).app"; \
	echo "Installed /Applications/$(APP_NAME).app"
else ifeq ($(UNAME_S),Linux)
PACKAGE_KIND := appimage
PACKAGE_OUTPUT := $(firstword $(wildcard $(RELEASE_DIR)/bundle/appimage/*.AppImage))
LOCAL_INSTALL_DESC := Copy release binary into ~/.local/bin
LOCAL_INSTALL_CMD = \
	mkdir -p "$(HOME_BIN)"; \
	install -m 755 "$(RELEASE_DIR)/$(APP_NAME)" "$(HOME_BIN)/$(APP_NAME)"; \
	echo "Installed $(HOME_BIN)/$(APP_NAME)"
else
PACKAGE_KIND :=
PACKAGE_OUTPUT :=
LOCAL_INSTALL_DESC := Unsupported on this OS
LOCAL_INSTALL_CMD = echo "install-local is only supported on macOS and Linux" && exit 1
endif

.PHONY: help install-deps dev build package install-local lint typecheck test test-frontend test-rust fmt fmt-check clippy ci clean

help:
	@printf "Available targets:\n"
	@printf "  install-deps  Install npm dependencies\n"
	@printf "  dev           Run the Tauri app in development mode\n"
	@printf "  build         Build the frontend bundle\n"
	@printf "  package       Build an OS-specific Tauri bundle (%s)\n" "$(PACKAGE_KIND)"
	@printf "  install-local Install the current app locally (%s)\n" "$(LOCAL_INSTALL_DESC)"
	@printf "  lint          Run frontend lint + Rust clippy\n"
	@printf "  typecheck     Run TypeScript type checks\n"
	@printf "  test          Run frontend and Rust tests\n"
	@printf "  fmt           Format Rust code\n"
	@printf "  fmt-check     Check Rust formatting\n"
	@printf "  ci            Run the local validation sequence\n"

install-deps:
	npm install

dev:
	npm run tauri dev

build:
	npm run build

package:
	@if [ -z "$(PACKAGE_KIND)" ]; then echo "package is only supported on macOS and Linux"; exit 1; fi
	npm run tauri build -- --bundles $(PACKAGE_KIND)
	@if [ -n "$(PACKAGE_OUTPUT)" ]; then echo "Created $(PACKAGE_OUTPUT)"; fi

install-local: package
	$(LOCAL_INSTALL_CMD)

lint:
	npm run lint
	cd "$(TAURI_DIR)" && cargo clippy --all-targets --all-features -- -D warnings

typecheck:
	npm run typecheck

test: test-frontend test-rust

test-frontend:
	npm run test -- --run

test-rust:
	cd "$(TAURI_DIR)" && cargo test

fmt:
	cd "$(TAURI_DIR)" && cargo fmt

fmt-check:
	cd "$(TAURI_DIR)" && cargo fmt --check

clippy:
	cd "$(TAURI_DIR)" && cargo clippy --all-targets --all-features -- -D warnings

ci: fmt-check clippy test-rust lint typecheck test-frontend build

clean:
	rm -rf "$(DIST_DIR)"
	cd "$(TAURI_DIR)" && cargo clean
