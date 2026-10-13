import next from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [...next, ...nextTypescript, { ignores: [".next/**", "next-env.d.ts"] }];

export default config;
