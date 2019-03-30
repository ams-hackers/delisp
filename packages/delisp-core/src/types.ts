//
// Types
//

export interface TConstant {
  tag: "constant";
  name: string;
}

export interface TApplication {
  tag: "application";
  op: { type: Type };
  args: Array<{ type: Type }>;
}

export interface TVar {
  tag: "type-variable";
  name: string;
  userSpecified: boolean;
}

export interface REmpty {
  tag: "empty-row";
}

export interface RExtension {
  tag: "row-extension";
  label: string;
  labelType: { type: Type };
  // TODO: Implement kind system!
  extends: { type: Type };
}

export type Row = REmpty | RExtension;

export type Type = TConstant | TApplication | TVar | Row;

export interface TypeSchema {
  tag: "type";
  tvars: string[];
  mono: Type;
}

//
// Constructor helpers
//

function tConstant(name: string): TConstant {
  return { tag: "constant", name };
}

// * -> * -> *
export const tcArrow = tConstant("->");
// * -> *
export const tcVector = tConstant("vector");
// row -> *
export const tcRecord = tConstant("record");
// *
export const tVoid = tConstant("void");
export const tBoolean = tConstant("boolean");
export const tNumber = tConstant("number");
export const tString = tConstant("string");

export function tVar(name: string, userSpecified = false): TVar {
  return {
    tag: "type-variable",
    name,
    userSpecified
  };
}

export function tUserDefined(name: string): TConstant {
  return {
    tag: "constant",
    name
  };
}

export function tApp(op: Type, ...args: Type[]): Type {
  return {
    tag: "application",
    op: { type: op },
    args: args.map(a => ({ type: a }))
  };
}

export function tVector(t: Type): Type {
  return tApp(tcVector, t);
}

export function tFn(args: Type[], out: Type): Type {
  return tApp(tcArrow, ...args, out);
}

export const emptyRow: REmpty = { tag: "empty-row" };

export const tRowExtension = (
  label: string,
  labelType: Type,
  row: Type
): RExtension => ({
  tag: "row-extension",
  label,
  labelType: { type: labelType },
  extends: { type: row }
});

export function tRow(
  fields: Array<{ label: string; type: Type }>,
  extending: Type = emptyRow
): Type {
  return fields.reduceRight(
    (row: Type, { label, type }): Row => tRowExtension(label, type, row),
    extending
  );
}

export function tRecord(
  fields: Array<{ label: string; type: Type }>,
  extending: Type = emptyRow
): Type {
  return tApp(tcRecord, tRow(fields, extending));
}
