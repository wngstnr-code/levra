import monad from "../../contracts/deployments/monad.json";
import { parseDeployment, type Deployment } from "./deployments";

/** The Monad mainnet deployment, bundled so a browser can use it without file access. */
export const monadDeployment: Deployment = parseDeployment(monad);
