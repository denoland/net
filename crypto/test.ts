// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { assert, assertEquals } from "../testing/asserts.ts";
import stdCrypto from "./mod.ts";
import * as bytes from "../bytes/mod.ts";
import { dirname, fromFileUrl } from "../path/mod.ts";
const moduleDir = dirname(fromFileUrl(import.meta.url));

const webCrypto = globalThis.crypto;

Deno.test("Different ways to perform the same operation should produce the same result", async () => {
  const inputString = "taking the hobbits to isengard";
  const inputBytes = new TextEncoder().encode(inputString);

  const emptyDigest =
    "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b";
  const expectedDigest =
    "ae30c171b2b5a047b7986c185564407672441934a356686e6df3a8284f35214448c40738e65b8c308e38b068eed91676";

  assertEquals(
    toHexString(stdCrypto.subtle.digestSync("SHA-384", inputBytes)),
    expectedDigest,
  );

  assertEquals(
    toHexString(stdCrypto.subtle.digestSync("SHA-384", new ArrayBuffer(0))),
    emptyDigest,
  );

  assertEquals(
    toHexString(await stdCrypto.subtle.digest("SHA-384", new ArrayBuffer(0))),
    emptyDigest,
  );

  assertEquals(
    toHexString(await webCrypto.subtle!.digest("SHA-384", new ArrayBuffer(0))),
    emptyDigest,
  );
});

Deno.test("Memory use should remain reasonable even with large inputs", async () => {
  const process = Deno.run({
    cmd: [Deno.execPath(), "--quiet", "run", "--no-check", "-"],
    cwd: moduleDir,
    stdout: "piped",
    stdin: "piped",
  });

  await process.stdin.write(
    new TextEncoder().encode(`
      import stdCrypto from "./mod.ts";
      import { _wasm } from "../_wasm_crypto/crypto.js";

      const { memory } = _wasm as { memory: WebAssembly.Memory };

      const toHexString = (bytes: ArrayBuffer): string =>
        new Uint8Array(bytes).reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");

      const heapBytesInitial = memory.buffer.byteLength;

      const smallData = new Uint8Array(64);
      const smallDigest = toHexString(stdCrypto.subtle.digestSync("BLAKE3", smallData.buffer));
      const heapBytesAfterSmall = memory.buffer.byteLength;

      const largeData = new Uint8Array(64_000_000);
      const largeDigest = toHexString(stdCrypto.subtle.digestSync("BLAKE3", largeData.buffer));
      const heapBytesAfterLarge = memory.buffer.byteLength;

      console.log(JSON.stringify(
        {
          heapBytesInitial,
          smallDigest,
          heapBytesAfterSmall,
          largeDigest,
          heapBytesAfterLarge,
        },
        null,
        2,
      ));
    `),
  );
  process.stdin.close();

  const stdout = new TextDecoder().decode(await process.output());
  const status = await process.status();
  process.close();

  assertEquals(status.success, true, "test subprocess failed");
  const {
    heapBytesInitial,
    smallDigest,
    heapBytesAfterSmall,
    largeDigest,
    heapBytesAfterLarge,
  }: {
    heapBytesInitial: number;
    smallDigest: string;
    heapBytesAfterSmall: number;
    largeDigest: string;
    heapBytesAfterLarge: number;
  } = JSON.parse(stdout);

  assertEquals(
    smallDigest,
    "4d006976636a8696d909a630a4081aad4d7c50f81afdee04020bf05086ab6a55",
    `test subprocess returned wrong hash (${smallDigest})`,
  );
  assertEquals(
    largeDigest,
    "64fee39c5a30a8af6287b4862eed4af93c2c3fde42d10c5350ac82237c2804b5",
    `test subprocess returned wrong hash (${largeDigest})`,
  );

  // Heap should stay under 2MB even though we provided a 64MB input.
  assert(
    heapBytesInitial < 2_000_000,
    `WASM heap was too large initially: ${
      (heapBytesInitial / 1_000_000).toFixed(1)
    } MB`,
  );
  assert(
    heapBytesAfterSmall < 2_000_000,
    `WASM heap was too large after small input: ${
      (heapBytesAfterSmall / 1_000_000).toFixed(1)
    } MB`,
  );
  assert(
    heapBytesAfterLarge < 2_000_000,
    `WASM heap was too large after large input: ${
      (heapBytesAfterLarge / 1_000_000).toFixed(1)
    } MB`,
  );
});

Deno.test("Memory use should remain reasonable even with many calls to digest()", async () => {
  const process = Deno.run({
    cmd: [Deno.execPath(), "--quiet", "run", "--no-check", "-"],
    cwd: moduleDir,
    stdout: "piped",
    stdin: "piped",
  });

  await process.stdin.write(
    new TextEncoder().encode(`
      import stdCrypto from "./mod.ts";
      import { _wasm } from "../_wasm_crypto/crypto.js";

      const { memory } = _wasm as { memory: WebAssembly.Memory };

      const heapBytesInitial = memory.buffer.byteLength;

      let state = new ArrayBuffer(0);

      const toHexString = (bytes: ArrayBuffer): string =>
        new Uint8Array(bytes).reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");

      for (let i = 0; i < 10_000; i++) {
        state = stdCrypto.subtle.digestSync({
          length: 8 + (i % 52),
          name: "BLAKE3"
        }, state);
      }

      const heapBytesFinal = memory.buffer.byteLength;

      const stateFinal = toHexString(state);

      console.log(JSON.stringify(
        {
          heapBytesInitial,
          heapBytesFinal,
          stateFinal,
        },
        null,
        2,
      ));
    `),
  );
  process.stdin.close();

  const stdout = new TextDecoder().decode(await process.output());
  const status = await process.status();
  process.close();

  assertEquals(status.success, true, "test subprocess failed");
  const {
    heapBytesInitial,
    heapBytesFinal,
    stateFinal,
  }: {
    heapBytesInitial: number;
    heapBytesFinal: number;
    stateFinal: string;
  } = JSON.parse(stdout);

  assert(
    heapBytesInitial < 2_000_000,
    `WASM heap was too large initially: ${
      (heapBytesInitial / 1_000_000).toFixed(1)
    } MB`,
  );
  assert(
    heapBytesFinal < 2_000_000,
    `WASM heap was too large after many digests: ${
      (heapBytesFinal / 1_000_000).toFixed(1)
    } MB`,
  );
  assertEquals(
    stateFinal,
    "6f709e9364efd3e3861a91b80477b9998d14721f3add99",
    `test subprocess returned wrong hash (${stateFinal})`,
  );
});

const toHexString = (bytes: ArrayBuffer): string =>
  new Uint8Array(bytes).reduce(
    (str, byte) => str + byte.toString(16).padStart(2, "0"),
    "",
  );

// Simple periodic data, but the periods shouldn't line up with any block
// or chunk sizes.
const aboutAMeg = bytes.repeat(
  new Uint8Array(1237).fill(0).map((_, i) => i % 251),
  839,
);

// These should all be equivalent views
const slicedView = new Int16Array(aboutAMeg.buffer, 226, 494443);
const dataView = new DataView(aboutAMeg.buffer, 226, 16 / 8 * 494443);
const slicedCopy = new Uint8Array(
  aboutAMeg.subarray(226, 226 + 16 / 8 * 494443),
);
const bufferCopy = slicedCopy.buffer;

// Test result when an error is expected for all algorithms.
const allErrors = {
  blake2b: Error,
  "blake2b-384": Error,
  "blake2b-256": Error,
  blake2s: Error,
  blake3: Error,
  keccak224: Error,
  keccak256: Error,
  keccak384: Error,
  keccak512: Error,
  md2: Error,
  md4: Error,
  md5: Error,
  ripemd160: Error,
  ripemd320: Error,
  sha1: Error,
  sha224: Error,
  sha256: Error,
  "sha3-224": Error,
  "sha3-256": Error,
  "sha3-384": Error,
  "sha3-512": Error,
  sha384: Error,
  sha512: Error,
  shake128: Error,
  shake256: Error,
} as const;

// Test inputs and expected results for each algorithm.
const _digestCases: [
  // Caption for test error messages.
  string,
  // The input messages pieces, all expected to produce the same hash
  // (presumably the same value but in different representations).
  unknown[][],
  // The digest options being used (typically none, {}).
  unknown,
  // The expected digest output for each hash algorithm, or an Error type if the
  // algorithm isn't expected to this input.
  Record<string, unknown>,
][] = [
  ["Empty", [[], [""], [new ArrayBuffer(0), new BigInt64Array(0)]], {}, {
    blake2b:
      "786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce",
    "blake2b-256":
      "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8",
    "blake2b-384":
      "b32811423377f52d7862286ee1a72ee540524380fda1724a6f25d7978c6fd3244a6caf0498812673c5e05ef583825100",
    blake2s: "69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9",
    blake3: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
    keccak224: "f71837502ba8e10837bdd8d365adb85591895602fc552b48b7390abd",
    keccak256:
      "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    keccak384:
      "2c23146a63a29acf99e73b88f8c24eaa7dc60aa771780ccc006afbfa8fe2479b2dd2b21362337441ac12b515911957ff",
    keccak512:
      "0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304c00fa9caf9d87976ba469bcbe06713b435f091ef2769fb160cdab33d3670680e",
    md2: "8350e5a3e24c153df2275c9f80692773",
    md4: "31d6cfe0d16ae931b73c59d7e0c089c0",
    md5: "d41d8cd98f00b204e9800998ecf8427e",
    ripemd160: "9c1185a5c5e9fc54612808977ee8f548b2258d31",
    ripemd320:
      "22d65d5661536cdc75c1fdf5c6de7b41b9f27325ebc61e8557177d705a0ec880151c3a32a00899b8",
    sha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    sha224: "d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "sha3-224": "6b4e03423667dbb73b6e15454f0eb1abd4597f9a1b078e3f5b5a6bc7",
    "sha3-256":
      "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
    "sha3-384":
      "0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004",
    "sha3-512":
      "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26",
    sha384:
      "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b",
    sha512:
      "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
    shake128:
      "7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26",
    shake256:
      "46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762fd75dc4ddd8c0f200cb05019d67b592f6fc821c49479ab48640292eacb3b7c4be",
  }],

  [
    "One zeroed byte",
    [["\x00"], ["", "\x00", "", ""], [new ArrayBuffer(1)], [
      new Uint8ClampedArray(1),
    ]],
    {},
    {
      blake2b:
        "2fa3f686df876995167e7c2e5d74c4c7b6e48f8068fe0e44208344d480f7904c36963e44115fe3eb2a3ac8694c28bcb4f5a0f3276f2e79487d8219057a506e4b",
      "blake2b-256":
        "03170a2e7597b7b7e3d84c05391d139a62b157e78786d8c082f29dcf4c111314",
      "blake2b-384":
        "cc01088536f784f0bb769e41c4957b6d0cde1fcc8cf1d91fc477d4dd6e3fbfcd43d1698d146f348b2c36a339682bec3f",
      blake2s:
        "e34d74dbaf4ff4c6abd871cc220451d2ea2648846c7757fbaac82fe51ad64bea",
      blake3:
        "2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213",
      keccak224: "b7e52d015afb9bb56c19955720964f1a68b1aba96a7a9454472927be",
      keccak256:
        "bc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a",
      keccak384:
        "9265ed0d889a1327114cffa6fa682dce051855e24f9393a3faa7e4791124c9db1abef28f95f677134edefc63b02066d9",
      keccak512:
        "40f0a44b4452c44baf401b49411f861caac716ba87be7d6894757f1114fcec44a4d4a9f44bcab569fabc676e761fe9d097dd191d5d9c71d66250b3e867071553",
      md2: "ee8dbae3bc62bdc94ea63f69c1bc26c9",
      md4: "47c61a0fa8738ba77308a8a600f88e4b",
      md5: "93b885adfe0da089cdf634904fd59f71",
      ripemd160: "c81b94933420221a7ac004a90242d8b1d3e5070d",
      ripemd320:
        "d15df650542c206f970c18117bc74e041e89697493726da37a6f3f0fb3dad8728d00fb27f0a84d52",
      sha1: "5ba93c9db0cff93f52b521d7420e43f6eda2784f",
      sha224: "fff9292b4201617bdc4d3053fce02734166a683d7d858a7f5f59b073",
      sha256:
        "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
      "sha3-224": "bdd5167212d2dc69665f5a8875ab87f23d5ce7849132f56371a19096",
      "sha3-256":
        "5d53469f20fef4f8eab52b88044ede69c77a6a68a60728609fc4a65ff531e7d0",
      "sha3-384":
        "127677f8b66725bbcb7c3eae9698351ca41e0eb6d66c784bd28dcdb3b5fb12d0c8e840342db03ad1ae180b92e3504933",
      "sha3-512":
        "7127aab211f82a18d06cf7578ff49d5089017944139aa60d8bee057811a15fb55a53887600a3eceba004de51105139f32506fe5b53e1913bfa6b32e716fe97da",
      sha384:
        "bec021b4f368e3069134e012c2b4307083d3a9bdd206e24e5f0d86e13d6636655933ec2b413465966817a9c208a11717",
      sha512:
        "b8244d028981d693af7b456af8efa4cad63d282e19ff14942c246e50d9351d22704a802a71c3580b6370de4ceb293c324a8423342557d4e5c38438f0e36910ee",
      shake128:
        "0b784469a0628e03861cd8a196dfafa0e9e8056d04cddcc49f0746b9ad43ccb2",
      shake256:
        "b8d01df855f7075882c636f6ddeacf41e5de0bbf30042ef0a86e36f4b8600d546c516501a6a3c821678d3d9943fa9e74b9b99fccd47aecc91dd1f4946b8355b3",
    },
  ],

  ["Output length: 20", [["", "hello world", ""], ["hello ", "world"]], {
    length: 20,
  }, {
    blake2b: Error,
    "blake2b-384": Error,
    "blake2b-256": Error,
    blake2s: Error,
    blake3: "d74981efa70a0c880b8d8c1985d075dbcbf679b9",
    keccak224: Error,
    keccak256: Error,
    keccak384: Error,
    keccak512: Error,
    md2: Error,
    md4: Error,
    md5: Error,
    ripemd160: "98c615784ccb5fe5936fbc0cbe9dfdb408d92f0f",
    ripemd320: Error,
    sha1: "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed",
    sha224: Error,
    sha256: Error,
    "sha3-224": Error,
    "sha3-256": Error,
    "sha3-384": Error,
    "sha3-512": Error,
    sha384: Error,
    sha512: Error,
    shake128: "3a9159f071e4dd1c8c4f968607c30942e120d815",
    shake256: "369771bb2cb9d2b04c1d54cca487e372d9f187f7",
  }],

  ["Output length: 3", [["hello world"], ["hell", "o w", "orld"]], {
    length: 3,
  }, {
    blake2b: Error,
    "blake2b-384": Error,
    "blake2b-256": Error,
    blake2s: Error,
    blake3: "d74981",
    keccak224: Error,
    keccak256: Error,
    keccak384: Error,
    keccak512: Error,
    md2: Error,
    md4: Error,
    md5: Error,
    ripemd160: Error,
    ripemd320: Error,
    sha1: Error,
    sha224: Error,
    sha256: Error,
    "sha3-224": Error,
    "sha3-256": Error,
    "sha3-384": Error,
    "sha3-512": Error,
    sha384: Error,
    sha512: Error,
    shake128: "3a9159",
    shake256: "369771",
  }],

  ["Output length: 123", [["hello world"], ["hell", "o w", "orld"]], {
    length: 123,
  }, {
    blake2b: Error,
    "blake2b-384": Error,
    "blake2b-256": Error,
    blake2s: Error,
    blake3:
      "d74981efa70a0c880b8d8c1985d075dbcbf679b99a5f9914e5aaf96b831a9e24a020ed55aed9a6ab2eaf3fd70d2c98c949e142d8f42a10250190b699e02cf9eb68612e1a556fee6cf726bcb0994f7d3e669eda394788f8c80a4f0ea056be3d4dffd8069d7ef9a714a47a4cdef62c5402a25d7994384b07bfcf8479",
    keccak224: Error,
    keccak256: Error,
    keccak384: Error,
    keccak512: Error,
    md2: Error,
    md4: Error,
    md5: Error,
    ripemd160: Error,
    ripemd320: Error,
    sha1: Error,
    sha224: Error,
    sha256: Error,
    "sha3-224": Error,
    "sha3-256": Error,
    "sha3-384": Error,
    "sha3-512": Error,
    sha384: Error,
    sha512: Error,
    shake128:
      "3a9159f071e4dd1c8c4f968607c30942e120d8156b8b1e72e0d376e8871cb8b899072665674f26cc494a4bcf027c58267e8ee2da60e942759de86d2670bba1aa47bffd20b48b1d2aa7c3349f8215d1b99ca65bdb1770a220f67456f602436032afce7f24e534e7bfcdab9b35affa0ff891074302c19970d7359a8c",
    shake256:
      "369771bb2cb9d2b04c1d54cca487e372d9f187f73f7ba3f65b95c8ee7798c527f4f3c2d55c2d46a29f2e945d469c3df27853a8735271f5cc2d9e889544357116bb60a24af659151563156eebbf68810dd95c6fcccac0650132ba30bef9bf75b0d483becb935be8688b26ffb294d8284edd64a97325d6be0a423f23",
  }],

  ["Output length: 0", [[""]], {
    length: 0,
  }, {
    blake2b: Error,
    "blake2b-384": Error,
    "blake2b-256": Error,
    blake2s: Error,
    blake3: "",
    keccak224: Error,
    keccak256: Error,
    keccak384: Error,
    keccak512: Error,
    md2: Error,
    md4: Error,
    md5: Error,
    ripemd160: Error,
    ripemd320: Error,
    sha1: Error,
    sha224: Error,
    sha256: Error,
    "sha3-224": Error,
    "sha3-256": Error,
    "sha3-384": Error,
    "sha3-512": Error,
    sha384: Error,
    sha512: Error,
    shake128: "",
    shake256: "",
  }],

  ["Negative length", [[""]], { length: -1 }, allErrors],

  ["Non-integer length", [[""]], { length: 1.5 }, allErrors],

  ["Too-large length", [[""]], {
    length: Number.MAX_SAFE_INTEGER * Number.MAX_SAFE_INTEGER,
  }, allErrors],

  ["About a meg", [[aboutAMeg]], {}, {
    blake2b:
      "81f197a4ced23ba7bfc9e5e84f417475371b22edb36089978734d1327c39ff75eeda6598ab1c63f0829aa437b68a526f04e622f714d9d7093150e6b2f9603b5c",
    "blake2b-256":
      "84b033ca29abf242e3761b1657e14768cbfb4e7fc28b3d9f0f34905e5f2aa92b",
    "blake2b-384":
      "0300b1c3d7deeca947263590d4777b0df0e7869ded64d63afafcfb3da4df5e542bfe309667436f534cd3b9cb9ee5f938",
    blake2s: "c1b9bffb9bb1fa42f26ce72ad457bef071a7713532c37b772a3a7e8b353551fc",
    blake3: "7fc79f34e187d62c474af7d57531a77f193ab6f2fae71c6de155b341cb592fe5",
    keccak224: "8186d48ddde40e518b203db01cc105f0d4a1f46341322730f9c61b51",
    keccak256:
      "c1b36a3fdc9d8c4f337a8f9cf627e703718fd2d2559b366ec310d75cd03ddc94",
    keccak384:
      "6acf1af74a00ee20aa0b03647858ed749f7cef64fcf990da3b49e48232002b2ede1e50295755ca9a06f43157cfb36dd6",
    keccak512:
      "726580def2ce92c4345c0dfe768417b022a5fc9a9fec4f960b314bf078bdc93f05057d83a8334454977960e27afaf0d3b7500e5ee862ed91fff3817a93820f63",
    md2: "7be15efc5de4e3c3d72c8d2b44d06606",
    md4: "45c7d06ad9f5b7aefd65dca06ca8bfb6",
    md5: "65ee3c415a2316553ebf2fdb2ccafd0b",
    ripemd160: "a7188285d5c8560c44deadbdbb095e8fe6ac8dec",
    ripemd320:
      "c8b3e7f51e851ae25cdf7df7ebbcbf3b54b04f8a95eb2595c13331923de988413dafd78e80e3b268",
    sha1: "74de0faec24034e7415e7a6ee379e509b29985b2",
    sha224: "cfb9e6dd8dc52cb0e843067467e58a03224fbe84004b955078c98a20",
    sha256: "ce0ae911a08c37d8e25605bc209c13e870ab3c4a40a7610ea3af989d9b0a00dd",
    "sha3-224": "c7b818905ca367b591d17b31cac9b3c3f9158f65968725a6c65c4d82",
    "sha3-256":
      "ff7934eb30afb91390adbd02ef2bf808eeac30bb4a7779f346a71962610874bd",
    "sha3-384":
      "7f97aca31fa48466fdcf029396305c09ee98c0a547ff095a24af7ada72beb8448fe5d12b8c2d7e0a48822e1fe8db0387",
    "sha3-512":
      "61bbdae5203bbf8a9effd083da83ebf18951668e658a810987ea2feb1fb810be5800fb03489a99e9f25979aa6c345477036afabcda612066b3c1213a72c05534",
    sha384:
      "6f6b2d594fc88bcdfb574524e580b79c7dd74980392ad526c357860a761c8075f27c4960a38c4668c56d64520a5bebff",
    sha512:
      "b3d3a7531e6bea36639bd9cf5a5c462f32d4f74a4b9878aad7405149d7962ad02e4cc1922133c43e9a2685f2927345a72c697144cbd69a895778126c1c59d455",
    shake128:
      "1e99e4ac28efec6bc3af203f6a161b976389a2d036d0e42026141860d1e3a08a",
    shake256:
      "e39016c524adfa6efd8019d6bc6584bbb912bed38ab896a546a2ef648e120838085103118d3409caab6ed847a67b27085bdce9ffaa6408410431a706625f07bf",
  }],

  [
    "Different views of the same bytes",
    [[slicedView], [slicedCopy], [bufferCopy], [dataView]],
    {},
    {
      blake2b:
        "dd3ce8111538e7de0842ce11835e38788b6c9436deb122dcfdf69a2fc51d0414e6e088e9ced8e275280eb945f135e5e9eb8000d0434427e67efeea8fc1f39cc5",
      "blake2b-256":
        "ee079520d28e52bcf61dbc1919e90d9a6c3cb66290f5f41c5521dae9c365c4fe",
      "blake2b-384":
        "fbedc985d108d0690e9121e8a11c23faf5fc22a164cf30b5448e8499a86e1acd750e00f096a1f44be484a74bc1a5d076",
      blake2s:
        "ecf3769441e140f8c8e0a2176cb4ef57fa09befc90a845ce5be8c99ada200bd2",
      blake3:
        "8549694280dea254adb1b856779d2d4f09256004e7536bbf544a1859e66b5f9c",
      keccak224: "93ef86f74392e3a635c65df746b0f990bcb13b053301e52f51fab144",
      keccak256:
        "029a0c3cca4954e17606ac31dd3ac30492e36ecfcac3dc73e269a336782f2f1d",
      keccak384:
        "013efe9f790d52b7cd28d8763cc2c6f12583660298d02f5c151096496980d990be734074fd133a689533cc8046fc212f",
      keccak512:
        "c9cb0ac5c3be4861fc65ecd5a385b6fd10a4dd5ab7a57ffa13de7fd5df4fd12c7e39e0e96a065dae9958dcff76a86a8c3d1a156c54ce5e1096161be4601606a1",
      md2: "69d392229ccf5996ee4ab2d48631389b",
      md4: "c52b6ab9e096c97956d5d38d000947d2",
      md5: "81f7e24f254ca2af692188d17b5103d8",
      ripemd160: "e4d0ecd208850e00726c0c481b888f8de06fbfce",
      ripemd320:
        "973fa1157c930b8f481af235d543cfd687670bf6967bbcfd602e9dba63762b6d61cf18a515465619",
      sha1: "b0161602fcdd324d2d0222b5c8d2873ff1f6452e",
      sha224: "926ed59d539deff483058be7c73bf38a5af127a6c9e7d4da36cb3c6e",
      sha256:
        "38fa97da941ae64bc1ec0d28fa14023e8041fd31857053d387d97e0ea1498203",
      "sha3-224": "61450c57c4007d6ff219566740cf3dd3acc731bba4ec7a63bf91597b",
      "sha3-256":
        "ec3e5fb22a6a7e2f404cb10fca361a3edc3a6f7eaaeb83a4142adf3f89e5b1d5",
      "sha3-384":
        "b846b92db6cb89cbd848c0eac14a13ae33481fbcd33410ac5d870819edf8a89b6d661b2bdb9aac71661fc541d708348e",
      "sha3-512":
        "8b43aec6757a768580ed9bb74e373040a25692054d5097cf0ab8f9b565c266ab6964aa02b1d54388b10bc80461f83dbc8cf9e59c8321124315b8058b1a057b2a",
      sha384:
        "8eda90d308b4ef5265209e5c8477755ab09b371cd748c411a721dcd0255030b7947a7fe5c79a39fd48e135be670b7855",
      sha512:
        "b7e29c5e61c67f5332740e01a1932be71aee0baf8e6d3156027585948cd58abbcf302de41978b0de26a0fb768708351963c6c01c1198e0dae7deaee448632445",
      shake128:
        "ab4c60827e1521de623d8b41227d6b4a7406875f44db2356091c10f9d78e55d7",
      shake256:
        "ad4ffc105a791884afd92917a64af4d9d25b1c9d41a8e06683ad03a62ee5c7166a98fdcb4b60ee55722582c0eb9f103be3b55166efa4c20fdfcc5a4e026330dd",
    },
  ],

  [
    "Different combinations of different views of the same bytes",
    [[slicedView, bufferCopy], [slicedCopy, "", slicedView], [
      "",
      bufferCopy,
      dataView,
    ], [dataView, new Uint8Array(), slicedCopy, ""]],
    {},
    {
      blake2b:
        "0ad2f5cb56954ada6e852adcd8b3a9147e92cb68859b13ddb511a6abee263c51e32db3a4a8a78152fa0638f726c9ac96fa1fda41898bc6d7a4017d7abdbf8480",
      "blake2b-256":
        "be41aad5e22791bfa0b6fc37cd35ecf32b5c6170f85aabcac839fb5e0315def9",
      "blake2b-384":
        "a6b745fab507fe0251102c67e7616416f94d3508160bde3cc033917469b804464a0394edaaa6d93dd28ba196df8dd970",
      blake2s:
        "627f9025def22ddbf8ccfba535900aa8dd79ce532778aeae138fa797dd479008",
      blake3:
        "5af7084d217935de95ffd87daadc037ba08bdda86e14e02716cb2eb4054e2297",
      keccak224: "5b620623f63faf310190cd69fada226f4ba51b5766c2eef4d69ec7f8",
      keccak256:
        "fbfcc67319c5a077a3304ff6a8bb791f1e8aa7005d0fb71511dedf706f3018db",
      keccak384:
        "72a509f9279f48192871c212a12316ef231a0ccdc063e543750d4fc635f07b4c7dc34dc0ad269b3e57013ac3eb9f092c",
      keccak512:
        "63cac04fe488807d59860ab58a802bd177d7a9ac0848578f952121a802542d7f2caf67138a06004a7f33eb4a3ba4fcab6fa650ee3986fa699030255c87aec6e6",
      md2: "b3e6098ae95a9e4e9375f0481597909e",
      md4: "fd3fd27b70e242ab32adcfc3978ee0f0",
      md5: "67162fd7a3a58a71b8dd3ee48d7a81de",
      ripemd160: "d4bdea1747dfc0cda2171c7b5a55b732feabb1cf",
      ripemd320:
        "7950ec7cc28d63f8adb36258e9eab00d555cdebb247d9b47757e98aa9d026e4f431edd10aa22d7f9",
      sha1: "77fd495a283c66d4f9c28351c510fbff1458adf5",
      sha224: "955a032fdcfb471142b979c30b93ed87c5ece98e7007510637f3f17a",
      sha256:
        "e077f0aedd7a63888226967b9709f20485f9425fc682f08b2ba4e14a1e6035af",
      "sha3-224": "9a98128a7f797cb533cdbfa3e99d3d74fdadf54acb0805d7aaca1d35",
      "sha3-256":
        "949f0ce70e07fea1a7cf5c7a20253badc88e8d20403d1e2b6f3898efcb6b2268",
      "sha3-384":
        "17b6f90433dd728dad9eed2c72ce128b359d52873d94b4764ddd9a58fcc47061448e0053f46d5add92230e6f41d54f9a",
      "sha3-512":
        "891d21e1a4c7de0b44e69a0ea4b821cf32ac0885b10540f6633c33ef409bb8993b1eb277addeb21595deb4f392b8eef306dfb832a100403e6cb16c070cde7df8",
      sha384:
        "0f3493e6027e30381d25d2902b00de9a6ad72deb000e8485d4a750356ec6aea755d6fd25330df843516ce2d3fcdd59ea",
      sha512:
        "28f8c2773ba1dc4774b6d97ca2c50d7cec871fb2b0cdbb0871a3c40d426a367c92b8635e29e8d09841e9a3e39b00855f200001040e5a8eb8be64f588855ac4aa",
      shake128:
        "8b8d4e2daec80c06cdf68170c54ade9745945bbd5f998763ac9f90586f203a3f",
      shake256:
        "5eb886f6cfe4460a3bac6e19bae068ea67e2d13507f880b770fe32c57914e9f10b6ffee3154e4bef277499055eb6c59138ecfa74f47c47b63edc451d57606b28",
    },
  ],
];
