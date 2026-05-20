# monorepo-template

A TypeScript monorepo template powered by [pnpm](https://pnpm.io) workspaces, [Turborepo](https://turborepo.dev), and [ESLint](https://eslint.org).

Maintained by [@withxat](https://github.com/withxat).

## Tech Stack

| Tool                                                 | Purpose                                                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [pnpm](https://pnpm.io)                              | Package manager with strict catalog mode                                                                                                |
| [Turborepo](https://turborepo.dev)                   | Monorepo build system and task runner                                                                                                   |
| [TypeScript](https://www.typescriptlang.org)         | Type checking via [`@withxat/tsconfig`](https://npmx.dev/@withxat/tsconfig)                                                             |
| [ESLint](https://eslint.org)                         | Linting **and** formatting via [`@withxat/eslint-config`](https://npmx.dev/@withxat/eslint-config) (Prettier is intentionally disabled) |
| [Lefthook](https://github.com/evilmartians/lefthook) | Git hooks                                                                                                                               |

## Project Structure

```
monorepo-template/
├── apps/                    # Application packages
├── packages/
│   └── ui/                  # Shared React component library
│       ├── src/
│       │   ├── components/  # 55 shadcn/ui components
│       │   ├── hooks/
│       │   ├── lib/
│       │   └── styles/
│       ├── components.json  # shadcn/ui config (base-nova style)
│       └── package.json
├── eslint.config.ts         # Root ESLint flat config
├── lefthook.yml             # Git hooks config
├── pnpm-workspace.yaml      # Workspace & catalog definitions
├── tsconfig.json            # Root TypeScript config
└── turbo.json               # Turborepo task pipeline
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (LTS recommended)
- [pnpm](https://pnpm.io/installation) 10.x

### Install

```sh
pnpm install
```

### Scripts

| Command          | Description                    |
| ---------------- | ------------------------------ |
| `pnpm typecheck` | Type-check all packages        |
| `pnpm lint`      | Lint all packages              |
| `pnpm lint:fix`  | Lint and auto-fix all packages |

All scripts run through Turborepo, so only affected packages are processed and results are cached.

## Packages

### `packages/ui`

A shared React component library built on [React 19](https://react.dev), [Tailwind CSS v4](https://tailwindcss.com), and [shadcn/ui](https://ui.shadcn.com) (base-nova style). It ships 55 components including accordion, button, calendar, chart, command palette, dialog, drawer, sidebar, and more.

````
The `tooltip` component has been added. Remember to wrap your app with the `TooltipProvider` component.

```tsx title="app/layout.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  )
}
```
````

**Subpath exports:**

```jsonc
{
	// e.g. import { Button } from "ui/button"
	"./*": "./src/components/*.tsx",

	// e.g. import { cn } from "ui/utils"
	"./utils": "./src/lib/index.ts",

	// e.g. import { useToggle } from "ui/hooks"
	"./hooks": "./src/hooks/index.ts",

	// e.g. import "ui/styles"
	"./styles": "./src/styles/globals.css",

	// e.g. import { ChevronDownIcon } from "ui/icons"
	"./icons": "./src/icons.ts",

	// e.g. import { toast } from "ui/sonner"
	"./sonner": "./src/sonner.ts"
}
```

**Peer dependencies:** `react`, `react-dom`, `tailwindcss` (versions managed by pnpm catalogs).

## Dependency Management

All dependency versions are centralized in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) using **strict catalog mode**. Packages reference catalogs instead of hardcoded versions, keeping everything in sync:

| Catalog    | Contents                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `devtool`  | `eslint`, `typescript`, `turbo`, `lefthook`, `jiti`, `@withxat/eslint-config`, `@withxat/tsconfig` |
| `react`    | `react`, `react-dom`, `@types/react`, `@types/react-dom`                                           |
| `tailwind` | `tailwindcss`                                                                                      |

Usage in any `package.json`:

```json
{
	"dependencies": {
		"react": "catalog:react"
	}
}
```

## Turborepo Tasks

Defined in [`turbo.json`](turbo.json):

| Task        | Dependencies | Caching   | Notes                            |
| ----------- | ------------ | --------- | -------------------------------- |
| `build`     | `^build`     | `dist/**` | Builds depend on upstream builds |
| `typecheck` | `^typecheck` | Cached    |                                  |
| `lint`      | `^lint`      | Cached    |                                  |
| `dev`       | None         | No cache  | Persistent (long-running)        |

## Git Hooks

[Lefthook](https://github.com/evilmartians/lefthook) runs two jobs in parallel on **pre-commit**:

1. **lint & format** -- runs `pnpm lint:fix` on staged files and re-stages fixes automatically (`stage_fixed: true`)
2. **typecheck** -- runs `pnpm typecheck` on changed TypeScript/JavaScript files

## Adding New Packages or Apps

1. Create a directory under `apps/` or `packages/`.
2. Add a `package.json` with the package name. Use `catalog:` references for shared dependencies.
3. Add `tsconfig.json` extending `@withxat/tsconfig` and `eslint.config.ts` using `@withxat/eslint-config`.
4. If the package has `build`, `typecheck`, or `lint` scripts, Turborepo will pick them up automatically.

## Author

**monorepo-template** © [Xat](https://github.com/withxat), Released under the [MIT](https://github.com/withxat/monorepo-template/blob/main/LICENSE) License.<br>
Authored and maintained by Xat with help from contributors ([list](https://github.com/withxat/monorepo-template/graphs/contributors)).

> [Blog](https://blog.xat.sh) · GitHub [@withxat](https://github.com/withxat) · Telegram [@withxat](https://t.me/withxat) · X [@withxat](https://x.com/withxat) · Email [i@xat.sh](mailto:i@xat.sh)
