.DEFAULT_GOAL=deploy

D=docker
DC=docker-compose
DC_BASE=-f docker-compose.base.yml
DC_ALL=$(DC_BASE) $(shell ls services/*/docker-compose.*.yml | sed 's/.*/-f &/' | tr '\n' ' ')

ENV=. .env &&

network-up:
	@$(D) network create public || true
	@$(D) network create private || true

network-down:
	@$(D) network rm public || true
	@$(D) network rm private || true

up: network-up
	$(DC) $(DC_ALL) up -d --remove-orphans $(SERVICE)

restart:
	$(DC) $(DC_ALL) up -d --force-recreate $(SERVICE)

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
	$(DC) $(DC_ALL) services

tracked:
	git ls-tree -r master --name-only

init:
	cp .env.example .env
	$(ENV) restic -r b2:$${B2_BUCKET} init

git-check:
	./scripts/check-git

git-push: git-check
	git push

deploy: git-push
	./scripts/deploy

ssh:
	$(ENV) ssh jane@$${REMOTE_IP}

check-ports:
	sudo netstat -tulpn | grep LISTEN

open-ports:
	sudo ufw-docker allow traefik 80/tcp
	sudo ufw-docker allow traefik 443/tcp

test-env:
	$(ENV) echo $${REMOTE_IP}

pull:
	@$(DC) $(DC_ALL) pull $(SERVICE)
