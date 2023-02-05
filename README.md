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

## Managing Node Environment/Dependencies

To get the benefits of DX tooling (including git hooks), you need to install the node dependencies.

First, install [nvm](https://nvm.sh) and use the version of node specified in this repository (`nvm use`).

Then, it's just a simple matter of running `npm install`, and all of the git hooks will be automatically installed.

## Managing Python Environment/Dependencies

### pyenv

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

### poetry

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

### Running Commands

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

## Templating

Passing down command line arguments and bespoke environment variables can only get you so far, and to really alleviate the "there's 5000 points I need to configure everywhere" problem, we're using templating as a solution (which will further help in cutting down bespoke command line/environment configuration to only where it's needed).

Here, we're using a "convention-over-configuration" approach to templating, and consuming the results of said templating.

Any file appended with a `.j2` will be rendered down into a file with the same name, except with the `.j2` extension stripped away (e.g. `services/$service/docker-compose.$container.yml.j2` will be rendered down into `services/$service/docker-compose.$container.yml`, and will be picked up by all of the Make commands as part of the docker-compose "fleet").

Since the rendered files 1. are auto-generated files (and thus don't belong in git histories), and 2. may contain sensitive secrets, we're intentionally choosing _not_ to commit the rendered files; you will be able to see which files will be rendered by the presence of a `.j2` file in the folder you're looking at.

> **NOTE**: Since it's tricky to change the name in a way that's 1. obvious (e.g. if we were to generate `traefik.static.generated.yml` from `traefik.static.yml.j2` for the sake of always making sure the generated files had a `.generated` part in their file name so it'd be easier to grep all generated files and gitignore them, it would be confusing to try to _guess_ what the generated file name would be when rendering a template), and 2. doesn't disrupt the existing flow (e.g. if we were to generate `docker-compose.$service.yml.generated` from `docker-compose.$service.yml.j2`, existing workflows around grepping for `docker-compose.*.yml` would break), we're simply going to settle with stripping the `.j2` from the template file name.
>
> That means there is NO way for us to automatically detect generated files based on their filename! So take care to add each generated file to the `.gitignore` list!

You can manually render the templates by running `make render` (mainly to inspect the generated files to see if they look correct). For deployment, to make the process as seamless as possible, it will automatically be run as part of `make deploy`, so there's no need to manually render down the templates before deployment to make the generated files reflect the latest values.

## Testing

Right now, we're testing various pieces of "logic" (i.e. standalone functions that do not have external dependencies), but plan to expand the tests to cover more behaviours, such as e2e testing and integration testing (if I ever get to terraform modules), i.e. actually running the things and checking that the behaviour is what we expect.

For now, simply run `make test` to run all the tests.

### Unit vs. Integration Tests

You'll note that _all_ tests are marked either with `@pytest.mark.unit` or `@pytest.mark.integration` - appropriately, for unit tests and integration tests respectively.

This allows us to run only unit tests and only integration tests (`make test-unit` and `make test-integration`) and separate them out.

This is useful because unit tests, unlike integration tests, test only the specific bits of _logic_ in its purest form; and so, they are able to be tested in _complete_ isolation, with mocks provided to them so they don't hit the actual filesystem/make live network calls.

In comparison, integration tests test the _executables_ that actually coordinate and run the bits of logic, interfacing with the "real world" (i.e. I/O, external dependencies). This means that it can't really be tested in isolation, though we can feed it fixtures (different from mocks) to keep the test results consistent.

This fundamental difference between testing isolated bits of logic vs. "executables" is why it's so useful to separate testing them - because, by their very nature, the integration tests are more likely to fail (due to the I/O involved) and in general will take longer (again, due to the I/O).

To mark the tests, we rely on yet another "convention over configuration": any tests that don't have explicit markings will be marked as a unit test. Any test with `integration` in its test name (i.e. `test_integration_*`) will be marked as an integration test.
