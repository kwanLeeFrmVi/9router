# Project Guidelines

- **Codebase search**: Always use the `ccc` skill (`ccc search <query>`) for semantic code search. Do NOT use the Explore agent, Agent tool, Grep tool, or any explorer commands for code search or codebase exploration tasks — use `ccc` instead.
  - Note: `--path` filters require glob patterns (e.g. `--path 'src/*'` not `--path 'src'`).
- **Index management**: Run `ccc index` at the start of each session and after any significant code changes to keep the semantic index fresh.
