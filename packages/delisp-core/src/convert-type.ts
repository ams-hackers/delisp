import { parseRecord } from "./convert-utils";
import { printHighlightedExpr } from "./error-report";
import {
  ASExpr,
  ASExprList,
  ASExprMap,
  ASExprSymbol,
  ASExprVector
} from "./sexpr";
import { generateUniqueTVar } from "./type-generate";
import {
  emptyRow,
  Monotype,
  tApp,
  tBoolean,
  tNumber,
  tRecord,
  tString,
  tVar,
  tVector,
  tVoid
} from "./types";

function convertSymbol(expr: ASExprSymbol): Monotype {
  switch (expr.name) {
    case "boolean":
      return tBoolean;
    case "number":
      return tNumber;
    case "string":
      return tString;
    case "void":
      return tVoid;
    case "_":
      return generateUniqueTVar(false, "__t");
    default:
      return tVar(expr.name);
  }
}

function convertList(expr: ASExprList): Monotype {
  const [op, ...args] = expr.elements;

  if (op.type !== "symbol") {
    throw new Error(
      printHighlightedExpr("Expected symbol as operator", expr.location)
    );
  }

  switch (op.name) {
    case "->":
      if (args.length < 1) {
        throw new Error(
          printHighlightedExpr(
            "Expected at least 1 argument",
            op.location,
            true
          )
        );
      }
      break;
    default:
      throw new Error(
        printHighlightedExpr("Unknown type constructor", op.location)
      );
  }

  return tApp(op.name, ...args.map(convert));
}

function convertVector(expr: ASExprVector): Monotype {
  if (expr.elements.length !== 1) {
    throw new Error(
      printHighlightedExpr("Expected exactly 1 argument", expr.location)
    );
  }
  return tVector(convert(expr.elements[0]));
}

function convertMap(expr: ASExprMap): Monotype {
  const { fields, tail } = parseRecord(expr);

  return tRecord(
    fields.map(({ label, value }) => ({
      label: label.name,
      type: convert(value)
    })),
    tail ? convert(tail) : emptyRow
  );
}

export function convert(expr: ASExpr): Monotype {
  switch (expr.type) {
    case "list":
      return convertList(expr);
    case "symbol":
      return convertSymbol(expr);
    case "vector":
      return convertVector(expr);
    case "map":
      return convertMap(expr);
    default:
      throw new Error(printHighlightedExpr("Not a valid type", expr.location));
  }
}
