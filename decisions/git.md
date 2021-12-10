I need a private code repository and a whole bunch of "extras" that come with it, such as:

- issue tracker
- docker registry (that auto-scans), if anything to serve as a "pull-through" cache
- npm registry (that auto-scans)
- CI/CD w/ JUnit history tracking
- auto-updater (dependabot or renovatebot)
- secret scanning _by default_
- code scanner for search
- wiki
- project management

GitHub obviously fits most of these, and is great. However, you can't self-host GitHub, boo.

GitLab? The problem with it is that it tries to do _everything_, and I don't like that.

I want a composable coding infrastructure that integrates well with each another.

|                    | GitHub Stack                       | GitLab Stack                       | Gitea Stack                                                       |
| ------------------ | ---------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| Issue Tracker      | Built-in is serviceable            | Built-in is serviceable            | Built-in is serviceable                                           |
| Task Management    | Built-in is serviceable            | Built-in is serviceable            | Todoist for extra awesome                                         |
| Wiki               | Only for public repos              | Built-in is serviceable            | Built-in is serviceable, alternatives: Papyrs, Slab               |
| Code Search        | Built-in is serviceable            | Built-in is serviceable            | Sourcegraph for extra awesome                                     |
| Secret Scanning    | $21/mo                             | Built-in is serviceable            | Gitleaks pre-receive hook                                         |
| Auto-Updater       | Built-in is serviceable            | Renovatebot                        | Renovatebot                                                       |
| Docker Registry    | Has built-in, but no auto-scanning | Has built-in, but no auto-scanning | Harbor                                                            |
| NPM Registry       | Has built-in, but no auto-scanning | Has built-in, but no auto-scanning | Would need to write my own Verdaccio plugin to auto-scan w/ Trivy |
| CI/CD              | Built-in is serviceable            | Built-in is _excellent_            | Drone/Jenkins/Circle?                                             |

Probably the best way to do it is via GitLab, and a bunch of templated `.gitlab-ci.yml` containing Trivy scanning bits of code...?
