import { captureEngine } from "./capture/engine.js";
import { stopAudioRecording } from "./capture/audio.js";
import { videoChunkStore } from "./capture/video.js";
import { loadRootEnv } from "./load-env.js";
import { startServer } from "./server.js";

loadRootEnv();
startServer();

async function shutdown(): Promise<void> {
  console.log("[server] shutting down");
  stopAudioRecording();
  captureEngine.stop();
  await videoChunkStore.closeAll();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
