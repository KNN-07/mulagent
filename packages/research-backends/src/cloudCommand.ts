import * as NodeURL from "node:url";

declare const __MULAGENT_CLOUD_PY__: string;
export function cloudCommand(action: string, directory: string) {
  return typeof __MULAGENT_CLOUD_PY__ === "undefined"
    ? [NodeURL.fileURLToPath(new URL("./cloud.py", import.meta.url)), action, directory]
    : ["-c", __MULAGENT_CLOUD_PY__, action, directory];
}
