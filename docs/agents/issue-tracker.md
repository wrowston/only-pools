# Issue tracker: GitHub

Issues and PRDs for this repository live as GitHub issues in `wrowston/only-pools`. Use the `gh` CLI for tracker operations from inside this clone so the repository is inferred from `origin`.

## Conventions

- Create an issue with `gh issue create`.
- Read an issue and its discussion with `gh issue view <number> --comments`.
- List issues with `gh issue list`, requesting structured JSON when filtering by labels or state.
- Comment with `gh issue comment <number>`.
- Apply or remove labels with `gh issue edit <number> --add-label <label>` or `--remove-label <label>`.
- Close an issue with `gh issue close <number>`.

## Pull requests as a triage surface

Pull requests are not treated as incoming feature requests. An explicitly named pull request may still be inspected when the user asks.

## Publishing

When an engineering skill says to publish a specification, plan, ticket, or other artifact to the issue tracker, create a GitHub issue in `wrowston/only-pools`.
