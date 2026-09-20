let inputDirectory = null,
  outputDirectory = null;
const supported = () =>
  typeof window !== "undefined" &&
  typeof window.showDirectoryPicker === "function";
const validFile = /\.(shp|shx|dbf|prj|cpg|zip|geojson|json|tiff?|epw)$/i;
export const directorySupport = supported;
export function resetDirectories() {
  inputDirectory = null;
  outputDirectory = null;
}
export async function chooseDirectory(which) {
  if (!supported())
    throw new Error(
      "Directory access is unavailable here. Use Choose files and browser downloads, or open in Chrome / Edge.",
    );
  const handle = await window.showDirectoryPicker({
    id: `geocim-${which}`,
    mode: which === "output" ? "readwrite" : "read",
  });
  const other = which === "output" ? inputDirectory : outputDirectory;
  if (other && (await handle.isSameEntry(other)))
    throw new Error(
      "Choose different input and output directories to protect your source files.",
    );
  if (which === "output") outputDirectory = handle;
  else inputDirectory = handle;
  return handle.name;
}
export async function inputFiles() {
  if (!inputDirectory) throw new Error("Choose an input directory first.");
  const files = [],
    names = new Set();
  let total = 0;
  async function walk(dir, depth) {
    if (depth > 8) throw new Error("Use a smaller input directory.");
    for await (const entry of dir.values()) {
      if (entry.name.startsWith(".")) continue;
      if (entry.kind === "directory") await walk(entry, depth + 1);
      else if (validFile.test(entry.name)) {
        const name = entry.name.toLowerCase();
        if (names.has(name))
          throw new Error(
            "Duplicate file names found in subfolders. Choose each dataset folder separately.",
          );
        names.add(name);
        const file = await entry.getFile();
        total += file.size;
        if (files.length >= 512 || total > 128 * 1024 * 1024)
          throw new Error(
            "Select a directory with at most 512 GIS files / 128 MiB.",
          );
        files.push(file);
      }
    }
  }
  await walk(inputDirectory, 0);
  if (!files.length)
    throw new Error("No supported GIS files found in this directory.");
  return files;
}
export function safeOutputName(name) {
  return (
    String(name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .slice(0, 160) || "GeoCIM-output"
  );
}
export async function writeOutput(
  data,
  name,
  type = "application/octet-stream",
) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  try {
    if (outputDirectory) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-"),
        fileName = `${stamp}-${crypto.randomUUID().slice(0, 6)}-${safeOutputName(name)}`;
      const handle = await outputDirectory.getFileHandle(fileName, {
          create: true,
        }),
        stream = await handle.createWritable();
      try {
        await stream.write(blob);
        await stream.close();
      } catch (e) {
        await stream.abort().catch(() => {});
        throw e;
      }
      window.dispatchEvent(
        new CustomEvent("geocim-output", {
          detail: { text: `${outputDirectory.name}/${fileName}` },
        }),
      );
      return fileName;
    }
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = safeOutputName(name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return name;
  } catch (e) {
    window.dispatchEvent(
      new CustomEvent("geocim-output", { detail: { error: e.message } }),
    );
    throw e;
  }
}
