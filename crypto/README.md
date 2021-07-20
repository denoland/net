# crypto

## Usage

```typescript
import crypto from "https://deno.land/std@$STD_VERSION/crypto/mod.ts";

// This will delegate to the runtime's WebCrypto implementation.
console.log(await crypto.subtle.digest("SHA-384", "hello world"));

// This will use a bundled WASM/Rust implementation.
console.log(await crypto.subtle.digest("BLAKE3", "hello world"));
```
