.DEFAULT_GOAL=up

D=docker
DC=docker-compose

DC_ALL=-f docker-compose.base.yml $(shell ls config/*/docker-compose.*.yml | sed 's/.*/-f &/' | tr '\n' ' ')

network-up:
	@$(D) network create public || true
	@$(D) network create private || true

network-down:
	@$(D) network rm public || true
	@$(D) network rm private || true

up: network-up
	$(DC) $(DC_ALL) up -d

down:
	$(DC) $(DC_ALL) down --remove-orphans
	$(MAKE) network-down

down-everything:
	@echo "Are you sure? [y/N] " && read ans && [ $${ans:-N} = y ]
	$(DC) $(DC_ALL) down --remove-orphans -v
	$(MAKE) network-down

logs:
	$(DC) $(DC_ALL) logs -f $(SERVICE)

check-config:
	$(DC) $(DC_ALL) config

tracked:
	git ls-tree -r master --name-only

init:
	cp .env.example .env
	touch config/reverse-proxy/acme.json
	chmod 600 config/reverse-proxy/acme.json
	htpasswd -Bc traefik.userfile jane

deploy:
	./scripts/deploy

ssh:
	source .env && ssh jane@$${REMOTE_IP}
