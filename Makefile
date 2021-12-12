.DEFAULT_GOAL=deploy

D=docker
DC=docker-compose
DC_BASE=-f docker-compose.base.yml
DC_ALL=$(DC_BASE) $(shell ls config/*/docker-compose.*.yml | sed 's/.*/-f &/' | tr '\n' ' ')

ENV=. .env &&

network-up:
	@$(D) network create public || true
	@$(D) network create private || true

network-down:
	@$(D) network rm public || true
	@$(D) network rm private || true

up: network-up
	$(DC) $(DC_ALL) up -d --remove-orphans $(SERVICE)

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
	$(ENV) restic -r b2:$${B2_BUCKET} init

deploy:
	./scripts/check-git
	git push
	./scripts/deploy

ssh:
	$(ENV) ssh jane@$${REMOTE_IP}

open-ports:
	$(ENV) ssh jane@$${REMOTE_IP} sudo netstat -tulpn | grep LISTEN

test-env:
	$(ENV) echo $${REMOTE_IP}

authelia-user:
	@$(D) run authelia/authelia:latest authelia hash-password $(PASSWORD)

pull:
	@$(DC) $(DC_ALL) pull $(SERVICE)
