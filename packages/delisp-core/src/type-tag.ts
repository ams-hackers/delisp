import { readType } from "./type-convert";
import { applySubstitution, normalizeValues } from "./type-utils";
import { Type } from "./types";
import { fromEntries, zip } from "./utils";

export function type(
  chunks: TemplateStringsArray,
  ...placeholders: Type[]
): Type {
  const tmpvars = placeholders.map((_, i) => `delisp_tmpl_${i}`);
  const typespec = chunks.reduce(
    (pre, post, i) => `${pre} ${tmpvars[i - 1]}  ${post}`
  );

  // `readType` usually normalizes the values type
  // automatically. However, because here we pass a placeholder type
  // variable, we don't want readType to think that the function will
  // return a single value, so we postpone the normalization until
  // after the placeholders have been substituted.

  const typeSchema = readType(typespec, false);
  const t = typeSchema.mono;
  return normalizeValues(
    applySubstitution(t, fromEntries(zip(tmpvars, placeholders)))
  );
}
