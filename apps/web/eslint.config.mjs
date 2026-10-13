import next from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  ...next,
  ...nextTypescript,
  { ignores: [".next/**", "next-env.d.ts"] },
];
