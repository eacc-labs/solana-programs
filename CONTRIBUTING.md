# Contributing

Thanks for your interest in contributing to this repository. ♥️

This project is an open-source, community-driven collection of well-structured Solana program implementations, intended to help newcomers learn and explore on-chain development.

Please follow the guidelines below to keep the repository consistent and maintainable.

---

## Repository Structure
- `anchor/` - Programs built using the Anchor framework
- `native/` - Programs built in native Rust
- `pinocchio/` - Programs built using Pinocchio crates

---

## Commit Messages

This repository follows **Conventional Commits**.


#### Format:

```
<type>(optional-scope): short, imperative description
```


#### Common Types:

- `<framework>` - adding a new program
- `feat` - functionality
- `fix` - bug fixes
- `docs` - documentation only changes
- `test` - tests only
- `refactor` - code changes without behavior change
- `chore` - tooling, configuration, or repo maintenance


#### Examples:

```
anchor: add counter program
native: add escrow program
feat(anchor/counter): add increment instruction
docs(pinocchio/counter): add account layout diagram
test(anchor/multisig): add CPI failure cases
```

---

### Tracker Issues

This repository uses long-living **tracker issues** to keep track of program implementations
(e.g. Native, Anchor, Pinocchio).

- Tracker issues are used **only for tracking progress**
- Do not use tracker issues for code review or technical discussion
- All implementation discussion, feedback, and iteration must happen in the **Pull Request**
- Reference the tracker issue in your PR description (do not close it)

---

## Pull Requests

- Keep PRs focused and minimal
- Reference related issues where applicable
- Ensure programs build and tests pass locally


## Issues & Work Assignment

Please **open an issue before starting work** on any new program, feature, or significant change.

- Use issues to discuss ideas, proposals, and improvements
- Wait for the issue to be **acknowledged or assigned** before starting work
- Only work on issues that are **assigned to you** to avoid duplicate efforts
- Small fixes (typos, minor documentation updates) may be submitted directly without an issue.

This helps keep contributions coordinated and ensures a smooth experience for everyone.

---

<p align="center">
  <em>
    Happy contributing & keep Accelerating !
  </em>
</p>
