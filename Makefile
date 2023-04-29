.DEFAULT_GOAL=deploy

# use $(MAKE) where possible, but for remote commands, $(M) makes more sense
M=make --no-print-directory
D=docker
DC=$(D) compose
DC_ALL=--project-directory . $(shell ls services/*/docker-compose.*.yml | sed 's/.*/-f &/' | tr '\n' ' ')
DIR=~/self-hosted
SERVER=vultr

ENV=. .env &&

PYTHON_PATH=PYTHONPATH=. # we want everything to be relative to the workspace root
VENV=poetry run # the commands might run in a different shell (CI/local/make), so we have to activate venv every time to be safe
PYTHON=$(PYTHON_PATH) $(VENV) python
PYTEST=$(PYTHON_PATH) $(VENV) pytest

# |------------------------- Commands to be run within the server -------------------------|
up:
	@$(DC) $(DC_ALL) up -d --remove-orphans $(SERVICE)

restart:
	@$(DC) $(DC_ALL) up -d --remove-orphans --force-recreate $(SERVICE)

restart-hard:
	@$(DC) $(DC_ALL) up -d --remove-orphans --force-recreate --renew-anon-volumes $(SERVICE)

down:
	@$(DC) $(DC_ALL) down --remove-orphans $(SERVICE)

down-everything:
	@echo "Are you sure? [y/N] " && read ans && [ $${ans:-N} = y ]
	@$(DC) $(DC_ALL) down --remove-orphans -v

rm:
	@$(DC) $(DC_ALL) rm --stop $(SERVICE)

rm-hard:
	@$(DC) $(DC_ALL) rm --stop -v $(SERVICE)

prune:
	@$(D) system prune -f --filter "label!=com.docker.keep-container=true"

pull:
	@$(DC) $(DC_ALL) pull $(SERVICE)

exec:
	@$(DC) $(DC_ALL) exec $(SERVICE) $(COMMAND)

run:
	@$(DC) $(DC_ALL) run --rm $(DC_RUN_OPTIONS) $(SERVICE) $(COMMAND)

sh:
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

# Spin up the backup container, which already has all of the configuration/commands "baked in".
# Note that we're explicitly bypassing the existing entrypoint (which actually does all of the heavy lifting),
# as we need to run this as a "one shot" and not schedule cron (which means this command would never exit).
backup:
	@$(DC) $(DC_ALL) run --rm --entrypoint="" backup /usr/local/bin/backup

list-snapshots:
	@$(DC) $(DC_ALL) run --rm backup snapshots

restore:
	@./scripts/restore-all.sh $(SNAPSHOT)

mem:
	free -h

# |------------------------- Commands to be run locally -------------------------|
tracked:
	git ls-tree -r master --name-only

init:
	$(ENV) restic -r b2:$${B2_BUCKET} init

check-config:
	$(DC) $(DC_ALL) config --quiet

git-check:
	./scripts/check-git.sh

git-pull: # gotta remember to add the option so that I don't end up having to check the submodules in again
	git pull --recurse-submodules

git-push: git-check
	git push

push-files:
	rsync -avzP --delete --exclude=.git --exclude=volumes --exclude=node_modules --exclude=.venv --exclude=.vscode --exclude=**/__pycache__ --exclude=.pytest_cache . $(SERVER):$(DIR)

render:
	$(PYTHON) ./scripts/render_all.py

deploy: check-config git-push render push-files
	$(M) ssh-command COMMAND='$(M) up prune open-ports'

ssh:
	ssh $(SERVER)

ssh-command:
	ssh $(SERVER) 'cd $(DIR) && $(COMMAND)'

lint: lint-js lint-py

lint-js:
	npm run lint

lint-py: lint-py-black lint-py-isort

lint-py-black:
	$(VENV) black --check .

lint-py-isort:
	$(VENV) isort --profile black --check .

# Run all tests
test: test-unit test-integration

test-unit:
	$(PYTEST) -m unit $(OPTIONS)

test-integration:
	$(PYTEST) -m integration $(OPTIONS)
