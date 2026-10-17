# Repository Guidelines

## Project Structure & Module Organization

This repository is currently an empty project scaffold. No source code, tests, assets, dependency manifests, or build configuration exist yet. Introduce directories as the implementation requires them; suggested locations are `src/` for application code, `tests/` for automated tests, and `docs/` for architecture and setup notes. Keep modules focused and group related functionality together.

## Build, Test, and Development Commands

No build, test, or local development commands are configured. When selecting a language and toolchain, add the appropriate dependency manifest and document exact installation, development, test, and build commands in `README.md`. Run commands from the repository root. Avoid documenting commands such as `npm test` until the corresponding scripts exist.

## Coding Style & Naming Conventions

Follow the chosen language’s standard conventions and configure its formatter and linter when introducing code. Use consistent indentation within each file, descriptive names, and small modules with clear responsibilities. Prefer names that describe behavior or domain concepts. Keep formatting-only changes separate from functional changes whenever practical.

## Testing Guidelines

No testing framework or coverage threshold has been established. Add tests alongside new behavior and regression tests for bug fixes. Use descriptive test names that identify the behavior and expected result. Document the test runner and its invocation once configured; tests should run without production credentials.

## Commit & Pull Request Guidelines

No Git history is available to establish existing commit conventions. Use concise, imperative commit subjects, such as `Add initial project setup`. Keep commits focused. Pull requests should explain the purpose, summarize changes, link relevant issues, and record validation commands and results. Include screenshots for visible UI changes and identify any remaining validation gaps.

## Security & Configuration

Never commit credentials, access tokens, or private customer data. Provide placeholder configuration examples and document required environment variables. Add appropriate ignore rules before introducing local secrets, dependencies, or generated artifacts.
