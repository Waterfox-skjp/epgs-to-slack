# Project

- Keep the implementation simple and easy to maintain. Only add dependencies or background services when necessary.
- Notify Slack about recording reservations, starts, and completions.
- Never include secrets (such as webhook URLs) in source code, logs, or commits.

# Git

- Follow Git Flow: branch from `develop` using `feature/*`; use `release/*` and `hotfix/*` as appropriate.
- Finish with a local commit. Push only when explicitly requested.
- Use Conventional Commits: English type/scope, Japanese description/body, and standard footer tokens. Mark breaking changes with `!` or `BREAKING CHANGE:`.

# Validation

- After code changes, run `npm run check` and `npm test`.
- Never send real Slack messages in tests.
