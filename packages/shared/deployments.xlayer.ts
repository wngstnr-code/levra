import xlayer from "../../contracts/deployments/xlayer.json";
import { parseDeployment, type Deployment } from "./deployments";

/** The X Layer mainnet deployment, bundled so a browser can use it without file access. */
export const xlayerDeployment: Deployment = parseDeployment(xlayer);
