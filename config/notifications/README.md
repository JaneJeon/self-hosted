The notification hub to route all notifications to (slack/discord) using a single HTTP call, which makes monitoring one-off processes (e.g. backup) easier

Note that the base "apprise" only includes the CLI; we need the API on top of it to make calls to it from other containers: https://github.com/caronc/apprise-api. Should probably configure it to be stateless and rely only on config files.
