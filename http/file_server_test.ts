// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "../testing/asserts.ts";
import { BufReader } from "../io/bufio.ts";
import { TextProtoReader } from "../textproto/mod.ts";
import { Response } from "./server.ts";
import { FileServerArgs } from "./file_server.ts";
import { dirname, fromFileUrl, join, resolve } from "../path/mod.ts";
import { iter, readAll, writeAll } from "../io/util.ts";

let fileServer: Deno.Process<Deno.RunOptions & { stdout: "piped" }>;

type FileServerCfg = Omit<FileServerArgs, "_"> & { target?: string };

const moduleDir = dirname(fromFileUrl(import.meta.url));
const testdataDir = resolve(moduleDir, "testdata");

async function startFileServer({
  target = ".",
  port = 4507,
  "dir-listing": dirListing = true,
  dotfiles = true,
}: FileServerCfg = {}) {
  fileServer = Deno.run({
    cmd: [
      Deno.execPath(),
      "run",
      "--quiet",
      "--allow-read",
      "--allow-net",
      "file_server.ts",
      target,
      "--cors",
      "-p",
      `${port}`,
      `${dirListing ? "" : "--no-dir-listing"}`,
      `${dotfiles ? "" : "--no-dotfiles"}`,
    ],
    cwd: moduleDir,
    stdout: "piped",
    stderr: "null",
  });
  // Once fileServer is ready it will write to its stdout.
  assert(fileServer.stdout != null);
  const r = new TextProtoReader(new BufReader(fileServer.stdout));
  const s = await r.readLine();
  assert(s !== null && s.includes("server listening"));
}

async function startFileServerAsLibrary({}: FileServerCfg = {}) {
  fileServer = await Deno.run({
    cmd: [
      Deno.execPath(),
      "run",
      "--quiet",
      "--allow-read",
      "--allow-net",
      "testdata/file_server_as_library.ts",
    ],
    cwd: moduleDir,
    stdout: "piped",
    stderr: "null",
  });
  assert(fileServer.stdout != null);
  const r = new TextProtoReader(new BufReader(fileServer.stdout));
  const s = await r.readLine();
  assert(s !== null && s.includes("Server running..."));
}

async function killFileServer() {
  fileServer.close();
  // Process.close() kills the file server process. However this termination
  // happens asynchronously, and since we've just closed the process resource,
  // we can't use `await fileServer.status()` to wait for the process to have
  // exited. As a workaround, wait for its stdout to close instead.
  // TODO(piscisaureus): when `Process.kill()` is stable and works on Windows,
  // switch to calling `kill()` followed by `await fileServer.status()`.
  await readAll(fileServer.stdout!);
  fileServer.stdout!.close();
}

interface StringResponse extends Response {
  body: string;
}

/* HTTP GET request allowing arbitrary paths */
async function fetchExactPath(
  hostname: string,
  port: number,
  path: string,
): Promise<StringResponse> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const request = encoder.encode("GET " + path + " HTTP/1.1\r\n\r\n");
  let conn: void | Deno.Conn;
  try {
    conn = await Deno.connect(
      { hostname: hostname, port: port, transport: "tcp" },
    );
    await writeAll(conn, request);
    let currentResult = "";
    let contentLength = -1;
    let startOfBody = -1;
    for await (const chunk of iter(conn)) {
      currentResult += decoder.decode(chunk);
      if (contentLength === -1) {
        const match = /^content-length: (.*)$/m.exec(currentResult);
        if (match && match[1]) {
          contentLength = Number(match[1]);
        }
      }
      if (startOfBody === -1) {
        const ind = currentResult.indexOf("\r\n\r\n");
        if (ind !== -1) {
          startOfBody = ind + 4;
        }
      }
      if (startOfBody !== -1 && contentLength !== -1) {
        const byteLen = encoder.encode(currentResult).length;
        if (byteLen >= contentLength + startOfBody) {
          break;
        }
      }
    }
    const status = /^HTTP\/1.1 (...)/.exec(currentResult);
    let statusCode = 0;
    if (status && status[1]) {
      statusCode = Number(status[1]);
    }

    const body = currentResult.slice(startOfBody);
    const headersStr = currentResult.slice(0, startOfBody);
    const headersReg = /^(.*): (.*)$/mg;
    const headersObj: { [i: string]: string } = {};
    let match = headersReg.exec(headersStr);
    while (match !== null) {
      if (match[1] && match[2]) {
        headersObj[match[1]] = match[2];
      }
      match = headersReg.exec(headersStr);
    }
    return {
      status: statusCode,
      headers: new Headers(headersObj),
      body: body,
    };
  } finally {
    if (conn) {
      Deno.close(conn.rid);
    }
  }
}

Deno.test(
  "file_server serveFile",
  async () => {
    await startFileServer();
    try {
      const res = await fetch("http://localhost:4507/README.md");
      assertEquals(res.headers.get("content-type"), "text/markdown");
      const downloadedFile = await res.text();
      const localFile = new TextDecoder().decode(
        await Deno.readFile(join(moduleDir, "README.md")),
      );
      assertEquals(downloadedFile, localFile);
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server serveFile in testdata",
  async () => {
    await startFileServer({ target: "./testdata" });
    try {
      const res = await fetch("http://localhost:4507/hello.html");
      assertEquals(res.headers.get("content-type"), "text/html");
      const downloadedFile = await res.text();
      const localFile = new TextDecoder().decode(
        await Deno.readFile(join(testdataDir, "hello.html")),
      );
      assertEquals(downloadedFile, localFile);
    } finally {
      await killFileServer();
    }
  },
);

Deno.test("serveDirectory", async function () {
  await startFileServer();
  try {
    const res = await fetch("http://localhost:4507/");
    const page = await res.text();
    assert(page.includes("README.md"));
    assert(page.includes(`<a href="/testdata/">testdata/</a>`));

    // `Deno.FileInfo` is not completely compatible with Windows yet
    // TODO(bartlomieju): `mode` should work correctly in the future.
    // Correct this test case accordingly.
    Deno.build.os !== "windows" &&
      assert(/<td class="mode">(\s)*\([a-zA-Z-]{10}\)(\s)*<\/td>/.test(page));
    Deno.build.os === "windows" &&
      assert(/<td class="mode">(\s)*\(unknown mode\)(\s)*<\/td>/.test(page));
    assert(page.includes(`<a href="/README.md">README.md</a>`));
  } finally {
    await killFileServer();
  }
});

Deno.test("serveFallback", async function () {
  await startFileServer();
  try {
    const res = await fetch("http://localhost:4507/badfile.txt");
    assertEquals(res.status, 404);
    const _ = await res.text();
  } finally {
    await killFileServer();
  }
});

Deno.test("checkPathTraversal", async function () {
  await startFileServer();
  try {
    const res = await fetch(
      "http://localhost:4507/../../../../../../../..",
    );

    assertEquals(res.status, 200);
    const listing = await res.text();
    assertStringIncludes(listing, "README.md");
  } finally {
    await killFileServer();
  }
});

Deno.test("checkPathTraversalNoLeadingSlash", async function () {
  await startFileServer();
  try {
    const res = await fetchExactPath("127.0.0.1", 4507, "../../../..");
    assertEquals(res.status, 400);
  } finally {
    await killFileServer();
  }
});

Deno.test("checkPathTraversalAbsoluteURI", async function () {
  await startFileServer();
  try {
    //allowed per https://www.w3.org/Protocols/rfc2616/rfc2616-sec5.html
    const res = await fetchExactPath(
      "127.0.0.1",
      4507,
      "http://localhost/../../../..",
    );
    assertEquals(res.status, 200);
    assertStringIncludes(res.body, "README.md");
  } finally {
    await killFileServer();
  }
});

Deno.test("checkURIEncodedPathTraversal", async function () {
  await startFileServer();
  try {
    const res = await fetch(
      "http://localhost:4507/%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2F..",
    );

    assertEquals(res.status, 404);
    const _ = await res.text();
  } finally {
    await killFileServer();
  }
});

Deno.test("serveWithUnorthodoxFilename", async function () {
  await startFileServer();
  try {
    const malformedRes = await fetch("http://localhost:4507/testdata/%");
    assertEquals(malformedRes.status, 400);
    await malformedRes.text(); // Consuming the body so that the test doesn't leak resources
  } finally {
    await killFileServer();
  }
});

Deno.test("CORS support", async function () {
  await startFileServer();
  try {
    const directoryRes = await fetch("http://localhost:4507/");
    assert(directoryRes.headers.has("access-control-allow-origin"));
    assert(directoryRes.headers.has("access-control-allow-headers"));
    assertEquals(directoryRes.status, 200);
    await directoryRes.text(); // Consuming the body so that the test doesn't leak resources

    const fileRes = await fetch("http://localhost:4507/testdata/hello.html");
    assert(fileRes.headers.has("access-control-allow-origin"));
    assert(fileRes.headers.has("access-control-allow-headers"));
    assertEquals(fileRes.status, 200);
    await fileRes.text(); // Consuming the body so that the test doesn't leak resources
  } finally {
    await killFileServer();
  }
});

Deno.test("printHelp", async function () {
  const helpProcess = Deno.run({
    cmd: [
      Deno.execPath(),
      "run",
      "--quiet",
      // TODO(ry) It ought to be possible to get the help output without
      // --allow-read.
      "--allow-read",
      "file_server.ts",
      "--help",
    ],
    cwd: moduleDir,
    stdout: "piped",
  });
  assert(helpProcess.stdout != null);
  const r = new TextProtoReader(new BufReader(helpProcess.stdout));
  const s = await r.readLine();
  assert(s !== null && s.includes("Deno File Server"));
  helpProcess.close();
  helpProcess.stdout.close();
});

Deno.test("contentType", async () => {
  await startFileServer();
  try {
    const res = await fetch("http://localhost:4507/testdata/hello.html");
    const contentType = res.headers.get("content-type");
    assertEquals(contentType, "text/html");
    await res.text(); // Consuming the body so that the test doesn't leak resources
  } finally {
    await killFileServer();
  }
});

Deno.test("file_server running as library", async function () {
  await startFileServerAsLibrary();
  try {
    const res = await fetch("http://localhost:8000");
    assertEquals(res.status, 200);
    const _ = await res.text();
  } finally {
    await killFileServer();
  }
});

Deno.test("file_server should ignore query params", async () => {
  await startFileServer();
  try {
    const res = await fetch("http://localhost:4507/README.md?key=value");
    assertEquals(res.status, 200);
    const downloadedFile = await res.text();
    const localFile = new TextDecoder().decode(
      await Deno.readFile(join(moduleDir, "README.md")),
    );
    assertEquals(downloadedFile, localFile);
  } finally {
    await killFileServer();
  }
});

async function startTlsFileServer({
  target = ".",
  port = 4577,
}: FileServerCfg = {}) {
  fileServer = Deno.run({
    cmd: [
      Deno.execPath(),
      "run",
      "--quiet",
      "--allow-read",
      "--allow-net",
      "file_server.ts",
      target,
      "--host",
      "localhost",
      "--cert",
      "./testdata/tls/localhost.crt",
      "--key",
      "./testdata/tls/localhost.key",
      "--cors",
      "-p",
      `${port}`,
    ],
    cwd: moduleDir,
    stdout: "piped",
    stderr: "null",
  });
  // Once fileServer is ready it will write to its stdout.
  assert(fileServer.stdout != null);
  const r = new TextProtoReader(new BufReader(fileServer.stdout));
  const s = await r.readLine();
  assert(s !== null && s.includes("server listening"));
}

Deno.test("serveDirectory TLS", async function () {
  await startTlsFileServer();
  try {
    // Valid request after invalid
    const conn = await Deno.connectTls({
      hostname: "localhost",
      port: 4577,
      certFile: join(testdataDir, "tls/RootCA.pem"),
    });

    await writeAll(
      conn,
      new TextEncoder().encode("GET / HTTP/1.0\r\n\r\n"),
    );
    const res = new Uint8Array(128 * 1024);
    const nread = await conn.read(res);
    assert(nread !== null);
    conn.close();
    const page = new TextDecoder().decode(res.subarray(0, nread));
    assert(page.includes("<title>Deno File Server</title>"));
  } finally {
    await killFileServer();
  }
});

Deno.test("partial TLS arguments fail", async function () {
  fileServer = Deno.run({
    cmd: [
      Deno.execPath(),
      "run",
      "--quiet",
      "--allow-read",
      "--allow-net",
      "file_server.ts",
      ".",
      "--host",
      "localhost",
      "--cert",
      "./testdata/tls/localhost.crt",
      "-p",
      `4578`,
    ],
    cwd: moduleDir,
    stdout: "piped",
    stderr: "null",
  });
  try {
    // Once fileServer is ready it will write to its stdout.
    assert(fileServer.stdout != null);
    const r = new TextProtoReader(new BufReader(fileServer.stdout));
    const s = await r.readLine();
    assert(
      s !== null && s.includes("--key and --cert are required for TLS"),
    );
  } finally {
    await killFileServer();
  }
});

Deno.test("file_server disable dir listings", async function () {
  await startFileServer({ "dir-listing": false });
  try {
    const res = await fetch("http://localhost:4507/");

    assertEquals(res.status, 404);
    const _ = await res.text();
  } finally {
    await killFileServer();
  }
});

Deno.test("file_server do not show dotfiles", async function () {
  await startFileServer({ dotfiles: false });
  try {
    let res = await fetch("http://localhost:4507/testdata/");
    assert(!(await res.text()).includes(".dotfile"));

    res = await fetch("http://localhost:4507/testdata/.dotfile");
    assertEquals((await res.text()), "dotfile");
  } finally {
    await killFileServer();
  }
});

Deno.test("file_server should show .. if it makes sense", async function (): Promise<
  void
> {
  await startFileServer();
  try {
    let res = await fetch("http://localhost:4507/");
    let page = await res.text();
    assert(!page.includes("../"));
    assert(page.includes("testdata/"));

    res = await fetch("http://localhost:4507/testdata/");
    page = await res.text();
    assert(page.includes("../"));
  } finally {
    await killFileServer();
  }
});

Deno.test(
  "file_server should download first byte of `hello.html` file",
  async () => {
    await startFileServer();
    try {
      const headers = {
        "range": "bytes=0-0",
      };
      const res = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
        { headers },
      );
      const text = await res.text();
      console.log(text);
      assertEquals(text, "L");
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server sets `content-range` header for range request responses",
  async () => {
    await startFileServer();
    try {
      const headers = {
        "range": "bytes=0-100",
      };
      const res = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
        { headers },
      );
      const contentLength = await getTestFileSize();
      assertEquals(
        res.headers.get("content-range"),
        `bytes 0-100/${contentLength}`,
      );

      await res.text(); // Consuming the body so that the test doesn't leak resources
    } finally {
      await killFileServer();
    }
  },
);

const getTestFileSize = async () => {
  const fileInfo = await getTestFileStat();
  return fileInfo.size;
};

const getTestFileStat = async (): Promise<Deno.FileInfo> => {
  const fsPath = join(testdataDir, "test file.txt");
  const fileInfo = await Deno.stat(fsPath);

  return fileInfo;
};

const getTestFileEtag = async () => {
  const fileInfo = await getTestFileStat();

  if (fileInfo.mtime instanceof Date) {
    const lastModified = new Date(fileInfo.mtime);
    const simpleEtag = await createEtagHash(
      `${lastModified.toJSON()}${fileInfo.size}`,
    );
    return simpleEtag;
  } else {
    return "";
  }
};

const createEtagHash = async (message: string) => {
  // see: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
  const hashType = "SHA-1"; // Faster, and this isn't a security senitive cryptographic use case
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest(hashType, msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return hashHex;
};

Deno.test(
  "file_server returns 206 for range request responses",
  async () => {
    await startFileServer();
    try {
      const headers = {
        "range": "bytes=0-100",
      };
      const res = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
        { headers },
      );
      await res.text(); // Consuming the body so that the test doesn't leak resources
      assertEquals(res.status, 206);
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server should download from 300 bytes into `hello.html` file until the end",
  async () => {
    await startFileServer();
    try {
      const headers = {
        "range": "bytes=300-",
      };
      const res = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
        { headers },
      );
      const text = await res.text();

      const localFile = new TextDecoder().decode(
        await Deno.readFile(join(testdataDir, "test file.txt")),
      );

      const contentLength = await getTestFileSize();
      assertEquals(
        res.headers.get("content-range"),
        `bytes 300-${contentLength - 1}/${contentLength}`,
      );
      assertEquals(text, localFile.substring(300));
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server should return 416 due to a bad range request (500-200)",
  async () => {
    await startFileServer();
    try {
      const headers = {
        "range": "bytes=500-200",
      };
      const res = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
        { headers },
      );
      await res.text();
      assertEquals(res.status, 416);
      assertEquals(res.statusText, "Range Not Satisfiable");
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server should return 416 due to a bad range request (-200)",
  async () => {
    await startFileServer();
    try {
      const headers = {
        "range": "bytes=-200",
      };
      const res = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
        { headers },
      );
      await res.text();
      assertEquals(res.status, 416);
      assertEquals(res.statusText, "Range Not Satisfiable");
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server should return 416 due to a bad range request (100)",
  async () => {
    await startFileServer();
    try {
      const headers = {
        "range": "bytes=100",
      };
      const res = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
        { headers },
      );
      await res.text();
      assertEquals(res.status, 416);
      assertEquals(res.statusText, "Range Not Satisfiable");
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server should return 416 due to a bad range request (a-b)",
  async () => {
    await startFileServer();
    try {
      const headers = {
        "range": "bytes=a-b",
      };
      const res = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
        { headers },
      );
      await res.text();
      assertEquals(res.status, 416);
      assertEquals(res.statusText, "Range Not Satisfiable");
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server returns correct mime-types",
  async () => {
    await startFileServer();
    try {
      const txtRes = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
      );
      assertEquals(txtRes.headers.get("content-type"), "text/plain");
      await txtRes.text(); // Consuming the body so that the test doesn't leak resources

      const htmlRes = await fetch("http://localhost:4507/testdata/hello.html");
      assertEquals(htmlRes.headers.get("content-type"), "text/html");
      await htmlRes.text(); // Consuming the body so that the test doesn't leak resources
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server sets `accept-ranges` header to `bytes` for directory listings",
  async () => {
    await startFileServer();
    try {
      const res = await fetch("http://localhost:4507/");
      assertEquals(res.headers.get("accept-ranges"), "bytes");
      await res.text(); // Consuming the body so that the test doesn't leak resources
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server sets `accept-ranges` header to `bytes` for file responses",
  async () => {
    await startFileServer();
    try {
      const res = await fetch("http://localhost:4507/testdata/test%20file.txt");
      assertEquals(res.headers.get("accept-ranges"), "bytes");
      await res.text(); // Consuming the body so that the test doesn't leak resources
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server sets `content-length` header correctly",
  async () => {
    await startFileServer();
    try {
      const res = await fetch("http://localhost:4507/testdata/test%20file.txt");
      const contentLength = await getTestFileSize();
      assertEquals(res.headers.get("content-length"), contentLength.toString());
      await res.text(); // Consuming the body so that the test doesn't leak resources
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server sets `Last-Modified` header correctly",
  async () => {
    await startFileServer();
    try {
      const res = await fetch("http://localhost:4507/testdata/test%20file.txt");

      const lastModifiedHeader = res.headers.get("last-modified") as string;
      const lastModifiedTime = Date.parse(lastModifiedHeader);

      const fileInfo = await getTestFileStat();
      const expectedTime = (fileInfo.mtime && fileInfo.mtime instanceof Date
        ? fileInfo.mtime.getTime()
        : Number.NaN);

      const round = (d: number) =>
        Math.floor(d / 1000 / 60 / 30); // Rounds epochs to 2 minute units, to accomodate minor variances in how long the test(s) take to execute
      assertEquals(round(lastModifiedTime), round(expectedTime));
      await res.text(); // Consuming the body so that the test doesn't leak resources
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server sets `Date` header correctly",
  async () => {
    await startFileServer();
    try {
      const round = (d: number) => Math.floor(d / 1000 / 60 / 30); // Rounds epochs to 2 minute units, to accomodate minor variances in how long the test(s) take to execute
      const now = Date.now();
      const res = await fetch("http://localhost:4507/testdata/test%20file.txt");
      const dateHeader = res.headers.get("date") as string;
      const date = Date.parse(dateHeader);
      assertEquals(round(date), round(now));
      await res.text(); // Consuming the body so that the test doesn't leak resources
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server file responses includes correct etag",
  async () => {
    await startFileServer();
    try {
      const res = await fetch("http://localhost:4507/testdata/test%20file.txt");
      const expectedEtag = await getTestFileEtag();
      assertEquals(res.headers.get("etag"), expectedEtag);
      await res.text(); // Consuming the body so that the test doesn't leak resources
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server returns 304 for requests with if-none-match set with the etag",
  async () => {
    await startFileServer();
    try {
      const expectedEtag = await getTestFileEtag();
      const headers = new Headers();
      headers.set("if-none-match", expectedEtag);
      const res = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
        { headers },
      );
      assertEquals(res.status, 304);
      assertEquals(res.statusText, "Not Modified");
      await res.text(); // Consuming the body so that the test doesn't leak resources
    } finally {
      await killFileServer();
    }
  },
);

Deno.test(
  "file_server returns an empty body for 304 responses from requests with if-none-match set with the etag",
  async () => {
    await startFileServer();
    try {
      const expectedEtag = await getTestFileEtag();
      const headers = new Headers();
      headers.set("if-none-match", expectedEtag);
      const res = await fetch(
        "http://localhost:4507/testdata/test%20file.txt",
        { headers },
      );
      assertEquals(await res.text(), "");
      await res.text(); // Consuming the body so that the test doesn't leak resources
    } finally {
      await killFileServer();
    }
  },
);
