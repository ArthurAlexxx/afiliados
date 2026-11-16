export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DISABLE_WORKER !== "1") {
    const { startWorker } = await import("./lib/pipeline");
    const { startBootstrap } = await import("./lib/bootstrap");
    startWorker();
    startBootstrap();
  }
}
