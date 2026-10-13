import { readFileSync } from "node:fs";
import { parseDeployment, type Deployment } from "./deployments";

/** Reads and validates a deployment file such as contracts/deployments/monad.json. Node only. */
export function readDeployment(path: string): Deployment {
  return parseDeployment(JSON.parse(readFileSync(path, "utf8")));
}
