import base from "../../contracts/deployments/base.json";
import { parseDeployment, type Deployment } from "./deployments";

/** The Base mainnet deployment, bundled so a browser can use it without file access. */
export const baseDeployment: Deployment = parseDeployment(base);
