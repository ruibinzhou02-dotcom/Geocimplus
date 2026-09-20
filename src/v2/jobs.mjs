export function job(type, payload, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
        new URL("./compute.worker.mjs", import.meta.url),
        { type: "module" },
      ),
      id = crypto.randomUUID(),
      timer = setTimeout(() => {
        worker.terminate();
        reject(
          new Error(
            "Local computation exceeded two minutes. Use a coarser grid.",
          ),
        );
      }, 120000);
    worker.onmessage = ({ data }) => {
      if (data.id !== id) return;
      if (data.progress !== undefined) {
        onProgress(data.progress);
        return;
      }
      clearTimeout(timer);
      worker.terminate();
      data.error ? reject(new Error(data.error)) : resolve(data.result);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ id, type, payload });
  });
}
