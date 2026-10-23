.PHONY: install run dev build start

NPM ?= npm

install:
	$(NPM) install

run: dev

dev:
	$(NPM) run dev

build:
	$(NPM) run build

start:
	$(NPM) run start
