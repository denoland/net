import wasmCrypto from "../_wasm_crypto/mod.ts";
import {
  DigestAlgorithm as WasmDigestAlgorithm,
  digestAlgorithms as wasmDigestAlgorithms,
} from "../_wasm_crypto/algorithms.ts";

/**
 * A copy of the global WebCrypto interface, with methods bound so they're
 * safe to re-export.
 */
const webCrypto: Crypto = ((crypto: Crypto) => ({
  getRandomValues: crypto.getRandomValues.bind(crypto),
  randomUUID: crypto.randomUUID.bind(crypto),
  ...crypto.subtle
    ? {
      subtle: {
        // decrypt: crypto.subtle.decrypt.bind(crypto.subtle),
        // deriveBits: crypto.subtle.deriveBits.bind(crypto.subtle),
        // deriveKey: crypto.subtle.deriveKey.bind(crypto.subtle),
        digest: crypto.subtle.digest.bind(crypto.subtle),
        // encrypt: crypto.subtle.encrypt.bind(crypto.subtle),
        // exportKey: crypto.subtle.exportKey.bind(crypto.subtle),
        generateKey: crypto.subtle.generateKey.bind(crypto.subtle),
        // importKey: crypto.subtle.importKey.bind(crypto.subtle),
        sign: crypto.subtle.sign.bind(crypto.subtle),
        // unwrapKey: crypto.subtle.unwrapKey.bind(crypto.subtle),
        verify: crypto.subtle.verify.bind(crypto.subtle),
        // wrapKey: crypto.subtle.wrapKey.bind(crypto.subtle),
      },
    }
    : {} as never,
}))(crypto);

/**
 * An wrapper for WebCrypto adding support for additional non-standard
 * algorithms, but delegating to the runtime WebCrypto implementation whenever
 * possible.
 */
const stdCrypto = {
  ...webCrypto,
  subtle: {
    ...webCrypto.subtle ?? {},

    async digest(
      algorithm: DigestAlgorithm,
      data: BufferSource,
    ): Promise<ArrayBuffer> {
      const { name, length, offset } = normalizeAlgorithm(algorithm);

      // We delegate to WebCrypto whenever possible,
      if (
        // if the SubtleCrypto interface is available,
        webCrypto.subtle &&
        // if the algorithm is supported by the WebCrypto standard,
        (webCryptoDigestAlgorithms as readonly string[]).includes(name) &&
        // if none of our non-standard options are specified:
        length === undefined &&
        offset === undefined
      ) {
        return await webCrypto.subtle!.digest(
          algorithm,
          data as unknown as Uint8Array,
        );
      } else if (wasmDigestAlgorithms.includes(name)) {
        // Otherwise, we use our bundled WASM implementation via digestSync
        // if it supports the algorithm.
        return stdCrypto.subtle.digestSync(algorithm, data);
      } else {
        // TypeScript should prohibit this case. Try WebCrypto in case they're
        // on a runtime that supports the non-standard algorithm.
        return await webCrypto.subtle!.digest(
          algorithm,
          data as unknown as Uint8Array,
        );
      }
    },

    digestSync(
      algorithm: DigestAlgorithm,
      data: BufferSource,
    ): ArrayBuffer {
      algorithm = normalizeAlgorithm(algorithm);

      let bytes: Uint8Array;
      if (data instanceof Uint8Array) {
        bytes = data;
      } else if (ArrayBuffer.isView(data)) {
        bytes = new Uint8Array(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        );
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else {
        throw new TypeError("digest input data is not a valid BufferSource");
      }

      return wasmCrypto.digest(
        algorithm.name,
        bytes,
        algorithm.length,
      );
    },
  },
};

/** Digest algorithms supported by WebCrypto. */
const webCryptoDigestAlgorithms = [
  "SHA-384",
  "SHA-256",
  "SHA-512",
  // insecure (length-extendable and collidable):
  "SHA-1",
] as const;

type DigestAlgorithmName = WasmDigestAlgorithm;

type DigestAlgorithmObject = {
  name: DigestAlgorithmName;
  length?: number;
  offset?: number;
};

type DigestAlgorithm = DigestAlgorithmName | DigestAlgorithmObject;

const normalizeAlgorithm = (algorithm: DigestAlgorithm) =>
  ((typeof algorithm === "string") ? { name: algorithm.toUpperCase() } : {
    ...algorithm,
    name: algorithm.name.toUpperCase(),
  }) as DigestAlgorithmObject;

export default stdCrypto;
