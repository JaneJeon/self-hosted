.DEFAULT_GOAL=up

D=docker
DC=$(D) compose

DC_ALL=-f docker-compose.base.yml $(shell ls config/*/docker-compose.*.yml | sed 's/.*/-f &/' | tr '\n' ' ')

network-up:
	@$(D) network create public || true
	@$(D) network create private || true

network-down:
	@$(D) network rm public || true
	@$(D) network rm private || true

up: network-up
	$(DC) $(DC_ALL) up -d

down: network-down
	$(DC) $(DC_ALL) down --remove-orphans

logs:
	$(DC) $(DC_ALL) logs -f

tracked:
	git ls-tree -r master --name-only
