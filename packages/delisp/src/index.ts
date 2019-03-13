import yargs from "yargs";

import { cmdCompile } from "./cmd-compile";
import { cmdFormat } from "./cmd-format";
import { cmdREPL } from "./cmd-repl";

// tslint:disable no-unused-expression
yargs
  .usage("usage: $0 <command>")
  .command(cmdREPL)
  .command(cmdFormat)
  .command(cmdCompile)
  .strict()
  .help("help").argv;
