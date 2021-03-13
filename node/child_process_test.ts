// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

import {
  assert,
  assertNotStrictEquals,
  assertStrictEquals,
} from "../testing/asserts.ts";
import { spawn } from "./child_process.ts";
import { Deferred, deferred } from "../async/deferred.ts";

const isWindows = Deno.build.os === "windows";

function withTimeout(timeoutInMS: number): Deferred<void> {
  const promise = deferred<void>();
  const timer = setTimeout(() => {
    promise.reject("Timeout");
  }, timeoutInMS);
  promise.then(() => {
    clearTimeout(timer);
  });
  return promise;
}

// TODO(uki00a): Once Node.js's `parallel/test-child-process-spawn-error.js` works, this test case should be removed.
Deno.test("[node/child_process spawn] The 'error' event is emitted when no binary is found", async () => {
  const promise = withTimeout(1000);
  const childProcess = spawn("no-such-cmd");
  childProcess.on("error", (_err) => {
    // TODO Assert an error message.
    promise.resolve();
  });
  await promise;
});

Deno.test("[node/child_process spawn] The 'exit' event is emitted with an exit code after the child process ends", async () => {
  const promise = withTimeout(3000);
  const childProcess = spawn(Deno.execPath(), ["--help"], {
    env: { NO_COLOR: "true" },
  });
  try {
    let exitCode = null;
    childProcess.on("exit", (code) => {
      promise.resolve();
      exitCode = code;
    });
    await promise;
    assertStrictEquals(exitCode, 0);
    assertStrictEquals(childProcess.exitCode, exitCode);
  } finally {
    childProcess.kill();
  }
});

Deno.test({
  name: "[node/child_process spawn] Verify that stdin and stdout work",
  fn: async () => {
    const promise = withTimeout(3000);
    const childProcess = spawn(Deno.execPath(), ["fmt", "-"], {
      env: { NO_COLOR: "true" },
      stdio: ["pipe", "pipe"],
    });
    try {
      assert(childProcess.stdin, "stdin should be defined");
      assert(childProcess.stdout, "stdout should be defined");
      let data = "";
      childProcess.stdout.on("data", (chunk) => {
        data += chunk;
      });
      childProcess.stdin.write("  console.log('hello')", "utf-8");
      childProcess.stdin.end();
      childProcess.on("exit", () => {
        promise.resolve();
      });
      await promise;
      assertStrictEquals(data, `console.log("hello");`);
    } finally {
      childProcess.kill();
    }
  },
});

// Copyright Joyent and Node contributors. All rights reserved. MIT license.
// Ported from Node 15.5.1

// TODO(uki00a): Remove this case once Node's `parallel/test-child-process-spawn-shell.js` works.
Deno.test("[child_process spawn] Verify that a shell is executed", async () => {
  const promise = withTimeout(3000);
  const doesNotExist = spawn("does-not-exist", { shell: true });
  assertNotStrictEquals(doesNotExist.spawnfile, "does-not-exist");
  doesNotExist.on("error", () => {
    promise.reject("The 'error' event must not be emitted.");
  });
  doesNotExist.on("exit", (code, signal) => {
    assertStrictEquals(signal, null);

    if (isWindows) {
      assertStrictEquals(code, 1); // Exit code of cmd.exe
    } else {
      assertStrictEquals(code, 127); // Exit code of /bin/sh });
    }

    promise.resolve();
  });
  await promise;
});

// TODO(uki00a): Remove this case once Node's `parallel/test-child-process-spawn-shell.js` works.
Deno.test("[node/child_process spawn] Verify that passing arguments works", async () => {
  const promise = withTimeout(3000);
  const echo = spawn("echo", ["foo"], {
    shell: true,
  });
  let echoOutput = "";

  assertStrictEquals(
    echo.spawnargs[echo.spawnargs.length - 1].replace(/"/g, ""),
    "echo foo",
  );
  assert(echo.stdout);
  echo.stdout.on("data", (data) => {
    echoOutput += data;
  });
  echo.on("close", () => {
    assertStrictEquals(echoOutput.trim(), "foo");
    promise.resolve();
  });
  await promise;
});

// TODO(uki00a): Remove this case once Node's `parallel/test-child-process-spawn-shell.js` works.
Deno.test("[node/child_process spawn] Verity that shell features can be used", async () => {
  const promise = withTimeout(3000);
  const cmd = "echo bar | cat";
  const command = spawn(cmd, {
    shell: true,
  });
  let commandOutput = "";

  assert(command.stdout);
  command.stdout.on("data", (data) => {
    commandOutput += data;
  });

  command.on("close", () => {
    assertStrictEquals(commandOutput.trim(), "bar");
    promise.resolve();
  });

  await promise;
});

// TODO(uki00a): Remove this case once Node's `parallel/test-child-process-spawn-shell.js` works.
Deno.test(
  "[node/child_process spawn] Verity that environment is properly inherited",
  async () => {
    const promise = withTimeout(3000);
    const env = spawn(
      `"${Deno.execPath()}" eval -p "Deno.env.toObject().BAZ"`,
      {
        env: { BAZ: "buzz", NO_COLOR: "true" },
        shell: true,
      },
    );
    let envOutput = "";

    assert(env.stdout);
    env.on("error", (err) => promise.reject(err));
    env.stdout.on("data", (data) => {
      envOutput += data;
    });
    env.on("close", () => {
      assertStrictEquals(envOutput.trim(), "buzz");
      promise.resolve();
    });
    await promise;
  },
);
/* End of ported part */