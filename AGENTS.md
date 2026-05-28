# Agent Guidelines

## Shell commands

- Use `rg -g "*.{ts,yaml}"` for file-type filtering — `rg --include` is invalid.

## Git commits

- Always commit normally (`git commit`). **Never** use `--no-verify` or
  `-c core.hooksPath=/dev/null` to skip hooks; if hooks fail, fix the root
  cause first.
- Dev dependencies must be installed (`npm install`) before committing so that
  the platform-specific `lefthook` binary (e.g. `lefthook-linux-arm64`) is
  present and the pre-commit hook can run. Verify with
  `ls node_modules | grep lefthook-linux` — if absent, run `npm install` again.
- If `package-lock.json` changes after an install, commit it in a follow-up
  `chore: bump dependencies`.
- If git reports "Author identity unknown", infer the name and email from the
  most recent commit (`git log --format="%an <%ae>" -1`) and pass them via
  `git -c user.name=… -c user.email=… commit -m "…"`.
