# Agent Rules

## Dependencies

- Always use the latest stable version of npm packages. Do not pin to older versions.
- When adding a new dependency, use the package manager (e.g. `pnpm add <pkg>`) to fetch the latest version. Do not manually write version numbers.
- Periodically check for outdated packages with `pnpm outdated` and update them.

## Portless

All apps and examples with dev servers use [portless](https://github.com/vercel-labs/portless) to avoid hardcoded ports. Portless assigns random ports and exposes each app via `.localhost` URLs.

Naming convention:
- Docs app: `docs.wterm` → `docs.wterm.localhost`
- Examples: `<name>.wterm` → `<name>.wterm.localhost`

When adding a new app or example that runs a dev server, wrap its `dev` script with `portless <name>`:

```json
{
  "scripts": {
    "predev": "command -v portless >/dev/null 2>&1 || (echo '\\nportless is required but not installed. Run: npm i -g portless\\nSee: https://github.com/vercel-labs/portless\\n' && exit 1)",
    "dev": "portless my-example.wterm next dev --turbopack"
  }
}
```

Do **not** add `--port` flags — portless handles port assignment automatically. Do **not** add portless as a project dependency; it must be installed globally.

## Documentation

For any user-facing change (new feature, option, API change, bug fix, etc.), update all relevant documentation:

- **Docs app** (`apps/docs/src/app/`): Update the corresponding MDX pages (e.g. `get-started/page.mdx`, `vanilla/page.mdx`, `react/page.mdx`, `configuration/page.mdx`, `themes/page.mdx`). Tables in MDX must use `<table>` HTML elements, not markdown table syntax.
- **Root README** (`README.md`): Keep the package table, features list, and development instructions current.
- **Package READMEs**: Each package under `packages/@wterm/` has its own `README.md`. Update the relevant one when its API, options, or usage changes.
- **Navigation** (`apps/docs/src/lib/docs-navigation.ts`): Update if adding or renaming pages.
- **Page titles** (`apps/docs/src/lib/page-titles.ts`): Update if adding new pages.
- **Code examples in docs**: Ensure import paths match the current package structure (e.g. `@wterm/dom` for vanilla JS, `@wterm/react` for React).
