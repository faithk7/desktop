# GitHub Desktop Custom

This fork keeps `development` as a clean mirror of
[`desktop/desktop`](https://github.com/desktop/desktop) and carries the custom
commit-history ordering feature on `custom/commit-history-order`.

## Remotes and branches

- `origin`: `https://github.com/faithk7/desktop.git`
- `upstream`: `https://github.com/desktop/desktop.git`
- upstream mirror: `development`
- customization: `custom/commit-history-order`

Never commit custom changes directly to `development`.

## Build and install on macOS

Use the Node and Python versions in `.tool-versions`. The repository's `.yarnrc`
redirects Yarn to the vendored Yarn release.

```sh
yarn
yarn build:custom
ditto "dist/GitHub Desktop Custom-darwin-arm64/GitHub Desktop Custom.app" \
  "/Applications/GitHub Desktop Custom.app"
codesign --verify --deep --strict "/Applications/GitHub Desktop Custom.app"
```

Launch the installed app and add local repositories again. Its bundle identifier
and application-data directory are separate from the official GitHub Desktop.

For development with hot reload, run `yarn start:custom` after the first build.

## Sync from upstream

Start with a clean worktree, then run:

```sh
script/sync-upstream-custom
```

The helper fetches both remotes, fast-forwards `development`, and rebases the
custom branch. It stops on conflicts and never stashes, resets, or discards work.
Resolve any rebase conflict normally, run the tests, and review the result.

To repeat the sync and push only after the full unit, lint, and custom-build
checks succeed:

```sh
script/sync-upstream-custom --push
```

The custom branch uses `--force-with-lease` because syncing rebases it; the
upstream mirror is pushed normally.
