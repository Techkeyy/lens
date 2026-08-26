import { readFileSync, readdirSync } from "node:fs";
import { hash, json } from "starknet";
const dir = process.argv[2];
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".contract_class.json") || f.includes("compiled")) continue;
  const sierra = json.parse(readFileSync(`${dir}/${f}`, "ascii"));
  console.log(`  ${f.padEnd(46)} ${hash.computeContractClassHash(sierra)}`);
}
