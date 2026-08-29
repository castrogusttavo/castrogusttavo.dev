# castrogusttavo.dev

Personal portfolio and technical blog, built with Next.js. Profile, work
history and pinned repos are pulled live from the GitHub API; writing lives
as bilingual Markdown in the repo itself.

## Stack

- [Next.js](https://nextjs.org) (App Router) + React 19 + TypeScript
- Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com) (`base-nova` style)
- [Biome](https://biomejs.dev) for lint/format, enforced via Husky + commitlint
- `react-markdown` + `remark-gfm` for rendering posts, `gray-matter` for frontmatter

## Getting started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The site is
locale-prefixed (`/pt`, `/en`) — there's no bare `/` route.

Set these in `.env` (gitignored, not checked in):

| Var | Used for |
| --- | --- |
| `GITHUB_TOKEN` | authenticated GitHub API calls (profile, pinned repos, contributions) |
| `HUGEICONS_TOKEN` | Hugeicons Pro icon set used across the UI |

## Writing

Posts live in `content/writing/<locale>/<slug>.md`, one file per language,
**same slug in both `pt/` and `en/`** — the language toggle just swaps the
URL prefix and expects the rest of the path to match. Frontmatter:
`title`, `description`, `icon` (key into `lib/writing-icons.ts`), optional
`date`.

Voice, structure and formatting rules for posts live in
[`ARTICLE.md`](./ARTICLE.md) — read it before writing or editing anything
under `content/writing/**`.

## Scripts

```bash
pnpm dev          # dev server
pnpm build        # production build
pnpm lint         # biome check
pnpm check        # biome check --fix
```

## Commits

Conventional Commits (`type(scope): description`), enforced by commitlint
on `commit-msg` and by a `pre-commit` hook running `biome check` +
`tsc --noEmit`. One intent per commit — see recent history for the shape.

## Not the Next.js you know

This repo pins a Next.js version whose docs/conventions may diverge from
what you'd expect from training data. See `AGENTS.md` / `CLAUDE.md`.
