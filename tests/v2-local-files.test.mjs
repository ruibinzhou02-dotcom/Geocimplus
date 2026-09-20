import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseDirectory,
  inputFiles,
  writeOutput,
  resetDirectories,
} from "../src/v2/local-files.mjs";
test("Directory import is read-only, rejects name collisions, exports only new files", async () => {
  const options = [],
    written = [],
    events = [];
  const source = {
    name: "input",
    values: async function* () {
      yield {
        name: "data.geojson",
        kind: "file",
        getFile: async () => new File(["{}"], "data.geojson"),
      };
    },
    isSameEntry: async (other) => source === other,
  };
  const target = {
    name: "output",
    isSameEntry: async (other) => target === other,
    getFileHandle: async (name, opts) => {
      assert.equal(opts.create, true);
      written.push(name);
      return {
        createWritable: async () => ({
          write: async (b) => assert.equal(await b.text(), "result"),
          close: async () => {},
        }),
      };
    },
  };
  let handle = source;
  globalThis.window = {
    showDirectoryPicker: async (o) => {
      options.push(o);
      return handle;
    },
    dispatchEvent: (e) => events.push(e),
  };
  try {
    resetDirectories();
    await chooseDirectory("input");
    assert.equal(options[0].mode, "read");
    assert.equal((await inputFiles()).length, 1);
    await assert.rejects(chooseDirectory("output"), /different/);
    handle = target;
    await chooseDirectory("output");
    assert.equal(options.at(-1).mode, "readwrite");
    await writeOutput("result", "data.geojson");
    await writeOutput("result", "data.geojson");
    assert.notEqual(written[0], written[1]);
    assert.match(written[0], /data.geojson$/);
    assert.equal(events.length, 2);
    source.values = async function* () {
      for (let i = 0; i < 2; i++)
        yield {
          name: "data.geojson",
          kind: "file",
          getFile: async () => new File(["{}"], "data.geojson"),
        };
    };
    await assert.rejects(inputFiles(), /Duplicate/);
  } finally {
    resetDirectories();
    delete globalThis.window;
  }
});
