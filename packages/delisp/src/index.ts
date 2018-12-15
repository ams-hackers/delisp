import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { startREPL } from "./repl";
import { readModule, compileModuleToString } from "@delisp/core";
import _mkdirp from "mkdirp";

const mkdirp = promisify(_mkdirp);

const files = process.argv.slice(2);

async function compileFile(file: string): Promise<void> {
  const cwd = process.cwd();
  const OUTPUT_DIR = path.join(cwd, ".delisp", "build");
  const outfile = path.resolve(OUTPUT_DIR, path.relative(cwd, file));

  const content = await fs.readFile(file, "utf8");
  const module = readModule(content);
  const code = compileModuleToString(module);

  await mkdirp(path.dirname(outfile));
  await fs.writeFile(outfile, code);
  return;
}

if (files.length === 0) {
  startREPL();
} else {
  Promise.all(files.map(compileFile)).catch(err => {
    console.error(err);
    process.exit(-1);
  });
}
