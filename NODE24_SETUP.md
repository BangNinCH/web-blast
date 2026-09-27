# Web Blast — Node.js 24 setup

This package is prepared for Node.js 24.x on Windows.

## Run immediately

1. Open CMD in this folder.
2. Run:

```cmd
npm start
```

The ZIP includes `node_modules`, including the prebuilt `better-sqlite3` binding, so a clean `npm install` is not required before the first run.

## Reinstall dependencies

The project includes `.npmrc` with `ignore-scripts=true` to avoid npm's current Windows/node-gyp issue with `better-sqlite3` 13.x. The package ships a Windows x64 prebuilt binding, so no C++ compilation is needed for the included environment.

If you intentionally remove `node_modules`, run `npm install` and keep `.npmrc` in place.

## Check Node

```cmd
node -v
```

Expected: `v24.x.x`.
