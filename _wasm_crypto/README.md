`std/_crypto_wasm` is only for internal use, such as by `std/crypto` and
`std/node/crypto`. Its interface may not be stable between releases and it
should not be imported directly.

## How to Build

### Prerequisite

Requires Rust's WASM target and the wasm-bindgen CLI.

```sh
cargo build --target wasm32-unknown-unknown
rustup target add wasm32-unknown-unknown

# This must match the version in hash/_wasm/Cargo.lock:
cargo install -f wasm-bindgen-cli --version 0.2.74
```

### Build

```sh
deno run --allow-all ./_build.ts
```

This will regenerate `./wasm_file.ts` and `./wasm_bindings.ts` from the Rust
source.
