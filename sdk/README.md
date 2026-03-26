# SDK (local)

This folder is a local SDK stub for development. To replace it with the real SDK as a Git submodule, run from the host repo root:

```bash
# add the SDK as a submodule at ./sdk
git submodule add https://github.com/fatkin1012/Orbit-SDK.git sdk
git submodule update --init --recursive
```

Notes:
- If `sdk/` is not empty, remove or move its contents before adding the submodule:

```bash
# remove the local stub (careful: this deletes files)
rm -rf sdk
# then add the submodule
git submodule add https://github.com/fatkin1012/Orbit-SDK.git sdk
```

- After adding the submodule, run `npm install` and then the usual build steps.
- The host's `tsconfig.json` already maps `@toolbox/sdk` to `./sdk/index.ts` for local type resolution.
