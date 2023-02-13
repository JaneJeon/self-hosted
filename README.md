[![Python CI](https://github.com/JaneJeon/self-hosted/actions/workflows/python.yml/badge.svg)](https://github.com/JaneJeon/self-hosted/actions/workflows/python.yml)
[![Node CI](https://github.com/JaneJeon/self-hosted/actions/workflows/node.yml/badge.svg)](https://github.com/JaneJeon/self-hosted/actions/workflows/node.yml)
[![Secrets Scan](https://github.com/JaneJeon/self-hosted/actions/workflows/secrets.yml/badge.svg)](https://github.com/JaneJeon/self-hosted/actions/workflows/secrets.yml)

## Prerequisites

Cloudflare account, domains, API token

## Deploy process

For now, I'll deploy from my local computer - I just don't trust myself to properly set up a CI to not leak credentials and fuck up production systems!

- (not yet implemented) run terraform to apply anything, generate secrets and dump them into gitignored files
- run `make deploy` to rsync this entire goddamn folder to the VPS over SSH or something (requires me to setup rsync first, or just scp or whatever it's called)
- run `make up` to reload all the goddamn things (note that docker-compose only reloads containers that have changed - either image or the actual docker-compose config)

## Creating a new service

Checklist for web-facing services:

- [ ] Traefik labels (incl. entrypoint)
- [ ] Authelia middleware label
- [ ] Flame label
- [ ] Restart policy
- [ ] Networks

Checklist for internal services:

- [ ] Restart policy
- [ ] Networks

## Connecting to the server

Use `~.ssh/config` to configure a specific host to connect to in the Makefile, named `vultr`, with your server's HostName and User.

Then tell Makefile to use that server SSH configuration using the `SERVER` variable.

## Managing the Server

### Backup/Restore

The way state is handled in this stack is that all stateful applications have volumes mounted onto where they need to read/write, and then we "aggregate" said volumes (living in the host) to backup/restore them in one go (i.e. we backup the "top-level" volumes folder containing all of the volume mounts in one go, and we restore that same folder so that the volume mounts are all restored in one go).

For databases, there's an additional layer of complexity in that what's on the filesystem may not necessarily reflect the "current state" of the application, as databases commonly "flush" to WAL, but doesn't necessarily update its own state files, trusting the WAL as the thing to restore from when recovering from a shutdown.

Therefore, for the databases, we forcefully "flush" their _entire_ state into something we _can_ backup/restore from (we'll call them "dump files" for now), and make sure to run the "dump state"/"restore state from the dump" whenever we backup/restore (in particular, the "dump state" should be run _before_ we run the backup, so the dump files are included in the backup, and the "restore from the dump" should be run _after_ we restore the folder, so that we actually have the dump files to work off of).

Currently, we are backing up the local `./volumes/` folder, but there are plans to migrate to using named Docker volumes instead and backup the `/var/lib/docker/volumes` folder [(which contains all Docker-managed volumes)](https://docs.docker.com/storage/#choose-the-right-type-of-mount) instead.

The backup/restore process of that "top-level" volumes folder is handled by `restic`, which takes _incremental_ snapshots of that folder as a whole, letting you "time travel" back to past snapshots, with very minimal costs (in terms of the additional disk space).

The actual backup is automatically done by the `restic-backup` container, which runs backup on startup (i.e. when you re-deploy that container, it will backup) and on schedule. The container already contains all of the scripts necessary for "dumping" databases.

You can also run the `make backup` command, which uses that exact container to backup the same way it normally does during scheduled backups, with the only difference being that the command is a "one shot" (i.e. doesn't schedule further backups, and exits with a status code 0 upon a successful backup and a nonzero code + an alert to Slack upon failure).

To restore, we first need to select the snapshot that we want to restore from (which will be especially relevant if you "fucked up" something and want to time travel to before you fucked up).

You can either choose from the latest snapshot (`make restore`), or specify a snapshot to restore from. For the latter, you can figure out which snapshot you want to restore from by running `make list-snapshots` to list all of the snapshots you can choose from. Copy the ID of the snapshot you want, and pass it into `make restore SNAPSHOT=$id`.

The restore script automatically handles "re-hydrating" from the database dump files.

> Note: `restic` and all of its subcommands will need to secure an exclusive lock, and they do this by touching some files in your backup destination. However, sometimes it doesn't work (especially when you have multiple processes running at the same time), perhaps due to the "object storage" of choice being _eventually_ consistent. In that case, you need to break the lock (after making sure no other `restic` process is currently running) by running:
>
> ```
> restic unlock
> ```
>
> (this can be run inside any of the `restic` containers - backup/prune/check)

## Local Development

### Managing Node Environment/Dependencies

To get the benefits of DX tooling (including git hooks), you need to install the node dependencies.

First, install [nvm](https://nvm.sh) and use the version of node specified in this repository (`nvm use`).

Then, it's just a simple matter of running `npm install`, and all of the git hooks will be automatically installed.

### Managing Python Environment/Dependencies

#### pyenv

First, install pyenv to control the version of python used (mainly for consistency and reproducibility): https://github.com/pyenv/pyenv#installation

(Optionally, install shell integrations: https://github.com/pyenv/pyenv#set-up-your-shell-environment-for-pyenv)

If you don't have the specific version in the `.python-version`, install the version specified in the repository (in this case, 3.11):

```sh
pyenv install 3.11
```

Then, to use the version of python specified in the repository (automatically), run:

```sh
pyenv local # every time you open up this directory, pyenv will automatically switch to the repo's specified python version
```

#### poetry

Now that we have pyenv set up for consistent python versions, we can install poetry for that specific python version:

```sh
pip install poetry # note that you don't have to specify pip3 thanks to pyenv
```

Then, "activate" the poetry environment using our pyenv-provided python:

```sh
poetry env use 3.11 # you may have to specify the full path to the pyenv python: https://python-poetry.org/docs/managing-environments/#switching-between-environments
```

Finally, we can install everything:

```sh
poetry install
```

Hooray!

> Note: by default, poetry installed via pyenv-provided python will install its dependencies inside the `.venv` folder, allowing your editor (like VS Code) to automatically pick up on the python dependencies when you use them in your code.
> However, if it doesn't, you may have to set the `virtualenvs.in-project` option to configure poetry to install the dependencies locally: https://python-poetry.org/docs/configuration#virtualenvsin-project (and this requires destroying and recreating the poetry environment).

#### Running Commands

Because poetry controls the dependencies (and "regular" python can't see its virtualenv), you need to use poetry to run any python commands.

You can either drop into a shell where all of that is already pre-configured:

```sh
poetry shell
```

Or, alternatively, just run your python commands using poetry:

```sh
poetry run python diagram.py
```

And either approach will let the pyenv-controlled python binary (which means it's going to use the "right" version) to pick up on all of the virtualenv dependencies.

Happy hacking!

### Templating

Passing down command line arguments and bespoke environment variables can only get you so far, and to really alleviate the "there's 5000 points I need to configure everywhere" problem, we're using templating as a solution (which will further help in cutting down bespoke command line/environment configuration to only where it's needed).

Here, we're using a "convention-over-configuration" approach to templating, and consuming the results of said templating.

Any file appended with a `.j2` will be rendered down into a file with the same name, except with the `.j2` extension stripped away (e.g. `services/$service/docker-compose.$container.yml.j2` will be rendered down into `services/$service/docker-compose.$container.yml`, and will be picked up by all of the Make commands as part of the docker-compose "fleet").

Since the rendered files 1. are auto-generated files (and thus don't belong in git histories), and 2. may contain sensitive secrets, we're intentionally choosing _not_ to commit the rendered files; you will be able to see which files will be rendered by the presence of a `.j2` file in the folder you're looking at.

> **NOTE**: Since it's tricky to change the name in a way that's 1. obvious (e.g. if we were to generate `traefik.static.generated.yml` from `traefik.static.yml.j2` for the sake of always making sure the generated files had a `.generated` part in their file name so it'd be easier to grep all generated files and gitignore them, it would be confusing to try to _guess_ what the generated file name would be when rendering a template), and 2. doesn't disrupt the existing flow (e.g. if we were to generate `docker-compose.$service.yml.generated` from `docker-compose.$service.yml.j2`, existing workflows around grepping for `docker-compose.*.yml` would break), we're simply going to settle with stripping the `.j2` from the template file name.
>
> That means there is NO way for us to automatically detect generated files based on their filename! So take care to add each generated file to the `.gitignore` list!

You can manually render the templates by running `make render` (mainly to inspect the generated files to see if they look correct). For deployment, to make the process as seamless as possible, it will automatically be run as part of `make deploy`, so there's no need to manually render down the templates before deployment to make the generated files reflect the latest values.

### Testing

Right now, we're testing various pieces of "logic" (i.e. standalone functions that do not have external dependencies), but plan to expand the tests to cover more behaviours, such as e2e testing and integration testing (if I ever get to terraform modules), i.e. actually running the things and checking that the behaviour is what we expect.

For now, simply run `make test` to run all the tests.

#### Unit vs. Integration Tests

You'll note that _all_ tests are marked either with `@pytest.mark.unit` or `@pytest.mark.integration` - appropriately, for unit tests and integration tests respectively.

This allows us to run only unit tests and only integration tests (`make test-unit` and `make test-integration`) and separate them out.

This is useful because unit tests, unlike integration tests, test only the specific bits of _logic_ in its purest form; and so, they are able to be tested in _complete_ isolation, with mocks provided to them so they don't hit the actual filesystem/make live network calls.

> Note: you'll also note that in unit testing individual modules, I often mock out the actual I/O call that _would've_ been made: whether it's network calls via the `responses` library, or filesystem access via the `pyfakefs` library. Being able to fake I/O calls not only reduce the I/O latency in tests, but they also allow me to set up bespoke network/filesystem responses _for every test_ without having to setup a pre-canned response (e.g. as with the fixtures/ folder that I use for integration tests) that needs to be shared by every unit test.

In comparison, integration tests test the _executables_ that actually coordinate and run the bits of logic, interfacing with the "real world" (i.e. I/O, external dependencies). This means that it can't really be tested in isolation, though we can feed it fixtures (different from mocks) to keep the test results consistent.

This fundamental difference between testing isolated bits of logic vs. "executables" is why it's so useful to separate testing them - because, by their very nature, the integration tests are more likely to fail (due to the I/O involved) and in general will take longer (again, due to the I/O).

To mark the tests, we rely on yet another "convention over configuration": any tests that don't have explicit markings will be marked as a unit test. Any test with `integration` in its test name (i.e. `test_integration_*`) will be marked as an integration test.

#### Debugging Tests

You can debug tests by running only one of them, or forcing pytest to let log/print statements through.

You can pass any options to the `make test-*` commands by setting the OPTIONS object. For example:

```sh
make test OPTIONS='-s' # to print output
```

## Security

### Scanning for Secrets

We use Gitleaks for securing this repo, and you'll need to make sure you have it installed locally for scanning secrets on commit. You can install it by running `brew install gitleaks`.

As for why Gitleaks... Trivy scanner doesn't match much of anything (see https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go), and while Trufflehog is awesome, it is not currently built out for "incremental" scans, such as scanning staged files.

If Trufflehog ever supports scanning one file at a time (or just integrates scanning staged files outright like gitleaks), I will drop gitleaks in a heartbeat. Until then, integrating gitleaks into pre-commit is the only "fast enough" way to do local, incremental scanning.

For CI, we do use the Trufflehog scanner because it scans all commits within a branch just fine.
