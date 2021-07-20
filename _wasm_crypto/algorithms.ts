// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

/**
 * All cryptographic hash/digest algorithms supported by std/_wasm_crypto.
 *
 * For algorithms that are supported by WebCrypto, the name here must match the
 * one used by WebCrypto. Otherwise we should prefer the formatting used in the
 * official specification. All names are uppercase to faciliate case-insensitive
 * comparisons required by the WebCrypto spec.
 */
export const digestAlgorithms = [
  "BLAKE2B-256",
  "BLAKE2B-384",
  "BLAKE2B",
  "BLAKE2S",
  "BLAKE3",
  "KECCAK-224",
  "KECCAK-256",
  "KECCAK-384",
  "KECCAK-512",
  "SHA-384",
  "SHA3-224",
  "SHA3-256",
  "SHA3-384",
  "SHA3-512",
  "SHAKE128",
  "SHAKE256",
  // insecure (length-extendable):
  "RIPEMD-160",
  "SHA-224",
  "SHA-256",
  "SHA-512",
  // insecure (collidable and length-extendable):
  "MD5",
  "SHA-1",
] as const;

/** A cryptographic hash/digest algorithm supported by std/_wasm_crypto. */
export type DigestAlgorithm = typeof digestAlgorithms[number];

/**
 * Other platforms may identify hash algorithms by slightly different names,
 * so we use this map of some common variations to the names we support.
 */
export const digestAliases: Record<string, DigestAlgorithm> = {
  "BLAKE2": "BLAKE2B",
  "BLAKE2B-512": "BLAKE2B",
  "BLAKE2B512": "BLAKE2B",
  "BLAKE2S-256": "BLAKE2S",
  "BLAKE2S256": "BLAKE2S",
  "KECCAK224": "KECCAK-224",
  "KECCAK256": "KECCAK-256",
  "KECCAK384": "KECCAK-384",
  "KECCAK512": "KECCAK-512",
  "RIPEMD160": "RIPEMD-160",
  "RMD-160": "RIPEMD-160",
  "RMD160": "RIPEMD-160",
  "SHA-2-224": "SHA-224",
  "SHA-2-256": "SHA-256",
  "SHA-2-384": "SHA-384",
  "SHA-2-512": "SHA-512",
  "SHA-3-224": "SHA3-224",
  "SHA-3-256": "SHA3-256",
  "SHA-3-384": "SHA3-384",
  "SHA-3-512": "SHA3-512",
  "SHA1": "SHA-1",
  "SHA2-224": "SHA-224",
  "SHA2-256": "SHA-256",
  "SHA2-384": "SHA-384",
  "SHA2-512": "SHA-512",
  "SHA224": "SHA-224",
  "SHA256": "SHA-256",
  "SHA384": "SHA-384",
  "SHA512": "SHA-512",
  "SHAKE-128": "SHAKE128",
  "SHAKE-256": "SHAKE256",
};
