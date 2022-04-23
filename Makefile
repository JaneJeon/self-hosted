.DEFAULT_GOAL=deploy

# use $(MAKE) where possible, but for remote commands, $(M) makes more sense
M=make --no-print-directory
D=docker
DC=docker-compose
DC_BASE=-f docker-compose.base.yml
DC_ALL=$(DC_BASE) $(shell ls services/*/docker-compose.*.yml | sed 's/.*/-f &/' | tr '\n' ' ')
DIR=~/self-hosted
SERVER=vultr

ENV=. .env &&

# |------------------------- Commands to be run within the server -------------------------|
network-up:
	@$(D) network create public || true
	@$(D) network create private || true

network-down:
	@$(D) network rm public || true
	@$(D) network rm private || true

up: network-up
	@$(DC) $(DC_ALL) up -d --remove-orphans $(SERVICE)

restart:
	@$(DC) $(DC_ALL) up -d --remove-orphans --force-recreate $(SERVICE)

restart-hard:
	@$(DC) $(DC_ALL) up -d --remove-orphans --force-recreate --renew-anon-volumes $(SERVICE)

down:
	@$(DC) $(DC_ALL) down --remove-orphans $(SERVICE)
	$(M) network-down

down-everything:
	@echo "Are you sure? [y/N] " && read ans && [ $${ans:-N} = y ]
	@$(DC) $(DC_ALL) down --remove-orphans -v
	$(M) network-down

rm:
	@$(DC) $(DC_ALL) rm --stop $(SERVICE)

rm-hard:
	@$(DC) $(DC_ALL) rm --stop -v $(SERVICE)

prune:
	@$(D) system prune -f

pull:
	@$(DC) $(DC_ALL) pull $(SERVICE)

exec: network-up
	@$(DC) $(DC_ALL) exec $(SERVICE) $(COMMAND)

run: network-up
	@$(DC) $(DC_ALL) run --rm $(SERVICE) $(COMMAND)

sh: network-up
	@$(DC) $(DC_ALL) run --rm $(SERVICE) sh

logs:
	@$(DC) $(DC_ALL) logs -f $(SERVICE)

volumes:
	@$(D) inspect -f '{{json .Mounts}}' $(SERVICE) | jq

ports:
	sudo netstat -tulpn | grep LISTEN

open-ports:
	sudo ufw-docker allow traefik 80/tcp
	sudo ufw-docker allow traefik 443/tcp

restore:
	./scripts/restore-all

# |------------------------- Commands to be run locally -------------------------|
tracked:
	git ls-tree -r master --name-only

init:
	cp .env.example .env
	$(ENV) restic -r b2:$${B2_BUCKET} init

check-config:
	@$(DC) $(DC_ALL) config --quiet

git-check:
	./scripts/check-git

git-push: git-check
	git push

push-files:
	rsync -avzP --delete --exclude=.git --exclude=volumes . $(SERVER):$(DIR)
	rsync -avzPO volumes $(SERVER):$(DIR) || true

deploy: check-config git-push push-files
	$(M) ssh-command COMMAND='$(M) prune up open-ports'

ssh:
	ssh $(SERVER)

ssh-command:
	ssh $(SERVER) 'cd $(DIR) && $(COMMAND)'
