// @techstark/opencv-js's UMD bundle contains Node-only code paths (reading
// its own script directory via `fs`/`path`, an `ENVIRONMENT_IS_NODE` branch
// that never actually runs in a browser) guarded by runtime checks —
// but Turbopack still statically resolves every `require(...)` it sees
// regardless of which branch it's in, so building for the browser fails on
// `Can't resolve 'fs'` unless something resolves to. This is an intentional
// empty stand-in for Node's fs/path/crypto builtins (see the `resolveAlias`
// entries in next.config.ts) — never actually executed, since the branches
// that import them only run when `ENVIRONMENT_IS_NODE` is true, which it
// never is in this app's client bundle.
export {};
