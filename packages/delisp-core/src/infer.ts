//
// This module implements type inference
//
// It is based on the paper "Generalizing Hindley-Milner Type Inference
// Algorithms", by Bastiaan Heeren, Jurriaan Hage and Doaitse Swierstra.
//
// You can find it online at
//
//   https://pdfs.semanticscholar.org/8983/233b3dff2c5b94efb31235f62bddc22dc899.pdf
//

import { InvariantViolation, assertNever } from "./invariant";

import {
  Expression,
  isExpression,
  isTypeAlias,
  Module,
  SVariableReference,
  STypeAlias,
  Syntax,
  Typed
} from "./syntax";

import { Substitution, transformRecurType } from "./type-utils";

import { printHighlightedExpr } from "./error-report";

import { generateUniqueTVar } from "./type-generate";
import { listTypeConstants } from "./type-utils";

import {
  emptyRow,
  Type,
  tBoolean,
  tFn,
  tNumber,
  tRecord,
  tEffect,
  tVariant,
  tString,
  tVector,
  TypeSchema
} from "./types";
import { difference, flatMap, last, mapObject, maybeMap } from "./utils";

import {
  findInlinePrimitive,
  isInlinePrimitive
} from "./compiler/inline-primitives";

import primitives from "./primitives";

import {
  TConstraint,
  constEqual,
  constEffect,
  constImplicitInstance,
  constExplicitInstance,
  solve
} from "./infer-solver";

import { applySubstitutionToExpr } from "./infer-subst";

// The type inference process is split in two stages. Firstly, `infer`
// will run through the syntax it will generate dummy type variables,
// together with a set of constraints and assumptions.
//

// A TAssumption is a variable instance for which we have assumed the
// type. Those variables are to be bound (and assumption removed)
// later, either by `let`, `lambda`, or global definitions.  Note: it
// is normal to have multiple assumptions (instances) for the same
// variable. Assumptions will be converted to additional constraints
// at the end of the inference process.
type TAssumption = SVariableReference<Typed>;

interface InferResult<A> {
  result: A;
  constraints: TConstraint[];
  assumptions: TAssumption[];
}

function inferMany(
  exprs: Expression[],
  monovars: string[],
  internalTypes: InternalTypeEnvironment
): InferResult<Array<Expression<Typed>>> {
  const results = exprs.map(e => infer(e, monovars, internalTypes));
  return {
    result: results.map(r => r.result),
    constraints: flatMap(r => r.constraints, results),
    assumptions: flatMap(r => r.assumptions, results)
  };
}

// Generate new types for an expression an all its subexpressions,
// returning and a set of constraints and assumptions between them.
function infer(
  expr: Expression,
  // A set of type variables names whose type is monomorphic. That is
  // to say, all instances should have the same type. That is the set
  // of type variables introduced by lambda.
  monovars: string[],
  // Known type aliases that must be expanded
  internalTypes: InternalTypeEnvironment
): InferResult<Expression<Typed>> {
  switch (expr.node.tag) {
    case "unknown":
      return {
        result: {
          ...expr,
          node: expr.node,
          info: { type: generateUniqueTVar(), effect: generateUniqueTVar() }
        },
        constraints: [],
        assumptions: []
      };

    case "number":
      return {
        result: {
          ...expr,
          node: expr.node,
          info: { type: tNumber, effect: generateUniqueTVar() }
        },
        constraints: [],
        assumptions: []
      };
    case "string":
      return {
        result: {
          ...expr,
          node: expr.node,
          info: { type: tString, effect: generateUniqueTVar() }
        },
        constraints: [],
        assumptions: []
      };
    case "vector": {
      const inferredValues = inferMany(
        expr.node.values,
        monovars,
        internalTypes
      );
      const t = generateUniqueTVar();
      const effect = generateUniqueTVar();
      return {
        result: {
          ...expr,
          node: {
            ...expr.node,
            values: inferredValues.result
          },
          info: { type: tVector(t), effect }
        },
        assumptions: inferredValues.assumptions,
        constraints: [
          ...inferredValues.constraints,
          ...inferredValues.result.map(e => constEqual(e, t)),
          ...inferredValues.result.map(e => constEffect(e, effect))
        ]
      };
    }

    case "record": {
      const inferred = expr.node.fields.map(({ label, value }) => ({
        label,
        ...infer(value, monovars, internalTypes)
      }));

      const tailInferred =
        expr.node.extends && infer(expr.node.extends, monovars, internalTypes);
      const tailRowType = generateUniqueTVar();

      const effect = generateUniqueTVar();

      return {
        result: {
          ...expr,
          node: {
            ...expr.node,
            fields: inferred.map(({ label, result: value }) => ({
              label,
              value
            })),
            extends: tailInferred && tailInferred.result
          },
          info: {
            type: tRecord(
              inferred.map(i => ({
                label: i.label.name,
                type: i.result.info.type
              })),
              tailInferred ? tailRowType : emptyRow
            ),
            effect
          }
        },
        assumptions: [
          ...flatMap(i => i.assumptions, inferred),
          ...(tailInferred ? tailInferred.assumptions : [])
        ],
        constraints: [
          ...flatMap(i => i.constraints, inferred),
          ...(tailInferred ? tailInferred.constraints : []),
          ...(tailInferred
            ? [
                constEqual(
                  tailInferred.result,
                  tRecord(
                    inferred.map(i => ({
                      label: i.label.name,
                      type: generateUniqueTVar()
                    })),
                    tailRowType
                  )
                )
              ]
            : []),

          ...inferred.map(i => constEffect(i.result, effect)),
          ...(tailInferred ? [constEffect(tailInferred.result, effect)] : [])
        ]
      };
    }
    case "variable-reference": {
      // as we found a variable, and because we lack an
      // 'environment/context', we generate a new type and add an
      // assumption for this variable.
      const t = generateUniqueTVar();
      const effect = generateUniqueTVar();
      const typedVar = {
        ...expr,
        node: {
          ...expr.node
        },
        info: {
          type: t,
          effect
        }
      };
      return {
        result: typedVar,
        constraints: [],
        assumptions: [typedVar]
      };
    }
    case "conditional": {
      const condition = infer(expr.node.condition, monovars, internalTypes);
      const consequent = infer(expr.node.consequent, monovars, internalTypes);
      const alternative = infer(expr.node.alternative, monovars, internalTypes);
      const t = generateUniqueTVar();
      const effect = generateUniqueTVar();

      return {
        result: {
          ...expr,
          node: {
            ...expr.node,
            condition: condition.result,
            consequent: consequent.result,
            alternative: alternative.result
          },
          info: {
            type: t,
            effect
          }
        },
        assumptions: [
          ...condition.assumptions,
          ...consequent.assumptions,
          ...alternative.assumptions
        ],
        constraints: [
          ...condition.constraints,
          ...consequent.constraints,
          ...alternative.constraints,
          constEqual(condition.result, tBoolean),
          constEqual(consequent.result, t),
          constEqual(alternative.result, t),

          constEffect(condition.result, effect),
          constEffect(consequent.result, effect),
          constEffect(alternative.result, effect)
        ]
      };
    }
    case "function": {
      const fnargs = expr.node.lambdaList.positionalArgs.map(a => a.name);
      const argtypes = fnargs.map(_ => generateUniqueTVar());

      const { result: typedBody, constraints, assumptions } = inferMany(
        expr.node.body,
        [...monovars, ...argtypes.map(v => v.node.name)],
        internalTypes
      );

      const bodyEffect = generateUniqueTVar();

      // Generate a constraint for each assumption pending for each
      // argument, stating that they are equal to the argument types
      // the new function type we have created.
      const newConstraints: TConstraint[] = [
        ...assumptions
          .filter(v => fnargs.includes(v.node.name))
          .map(v => {
            const varIndex = fnargs.indexOf(v.node.name);
            return constEqual(v, argtypes[varIndex]);
          }),

        ...typedBody.map(form => constEffect(form, bodyEffect))
      ];

      return {
        result: {
          ...expr,
          node: {
            ...expr.node,
            body: typedBody
          },
          info: {
            type: tFn(argtypes, bodyEffect, last(typedBody)!.info.type),
            // This is the effect of evaluating the lambda itself, not
            // calling it, that's why we don't specify any specific
            // effect.
            effect: generateUniqueTVar()
          }
        },
        constraints: [...constraints, ...newConstraints],
        // assumptions have already been used, so they can be deleted.
        assumptions: assumptions.filter(v => !fnargs.includes(v.node.name))
      };
    }

    case "function-call": {
      const ifn = infer(expr.node.fn, monovars, internalTypes);
      const iargs = inferMany(expr.node.args, monovars, internalTypes);
      const tTo = generateUniqueTVar();
      const effect = generateUniqueTVar();
      const tfn: Type = tFn(iargs.result.map(a => a.info.type), effect, tTo);

      return {
        result: {
          ...expr,
          node: {
            ...expr.node,
            fn: ifn.result,
            args: iargs.result
          },
          info: { type: tTo, effect }
        },

        constraints: [
          constEqual(ifn.result, tfn) as TConstraint,
          ...ifn.constraints,
          ...iargs.constraints,

          constEffect(ifn.result, effect),
          ...iargs.result.map(a => constEffect(a, effect))
        ],

        assumptions: [...ifn.assumptions, ...iargs.assumptions]
      };
    }

    case "let-bindings": {
      // let introduces complexities, as it is where let-polymorphism
      // happens. That is, the monotypes of the values are generalized
      // to polytypes.
      //
      // That means that, for example,
      //
      // (let ((id (lambda (x) x)))
      //   (id "foo")
      //   (id 0))
      //
      // is valid. The type of the identity function is generalized
      // from a0->a0 to a schema forall a. a -> a.  So each usage of
      // `id` in the body is constrainted to be an instance (and not
      // equal) of this type.
      //

      // Variables showing up in the bindings
      const vars = new Set(expr.node.bindings.map(b => b.variable.name));
      const toBeBound = (vname: string) => vars.has(vname);

      const bindingsInfo = expr.node.bindings.map(b => {
        return {
          binding: b,
          inference: infer(b.value, monovars, internalTypes)
        };
      });
      const bodyInference = inferMany(expr.node.body, monovars, internalTypes);

      const effect = generateUniqueTVar();

      return {
        result: {
          ...expr,
          node: {
            ...expr.node,
            bindings: bindingsInfo.map(b => ({
              ...b.binding,
              value: b.inference.result
            })),
            body: bodyInference.result
          },
          info: {
            type: last(bodyInference.result)!.info.type,
            effect
          }
        },
        constraints: [
          ...bodyInference.constraints,
          ...flatMap(i => i.inference.constraints, bindingsInfo),
          // For each variable in the binding list, we have to add
          // constraints that state that all the assumed types for the
          // variable until now in the body are actually instances of
          // the generalized polytype of the value to be bound.
          ...bodyInference.assumptions
            // Consider variables to be bound
            .filter(v => toBeBound(v.node.name))
            .map(v => {
              // We just filter the assumptions to the variables
              // that are bound, so we know it must is defined.
              const bInfo = bindingsInfo.find(
                bi => bi.binding.variable.name === v.node.name
              )!;
              return constImplicitInstance(
                v,
                monovars,
                bInfo.inference.result.info.type
              );
            }),

          // We require let-binding values to be free of effects
          ...bindingsInfo.map(b =>
            constEffect(b.inference.result, tEffect([]))
          ),
          // But we require all forms of the body to have the same
          // kind of effects.
          ...bodyInference.result.map(form => constEffect(form, effect))
        ],
        assumptions: [
          ...bodyInference.assumptions.filter(v => !toBeBound(v.node.name)),
          ...flatMap(bi => bi.inference.assumptions, bindingsInfo)
        ]
      };
    }

    case "type-annotation": {
      const inferred = infer(expr.node.value, monovars, internalTypes);
      const t = expandTypeAliases(
        expr.node.typeWithWildcards.instantiate(),
        internalTypes
      );

      return {
        result: {
          ...expr,
          node: {
            ...expr.node,
            value: inferred.result
          },
          info: {
            type: t,
            effect: inferred.result.info.effect
          }
        },
        assumptions: inferred.assumptions,
        constraints: [...inferred.constraints, constEqual(inferred.result, t)]
      };
    }

    case "do-block": {
      const body = inferMany(expr.node.body, monovars, internalTypes);
      const returning = infer(expr.node.returning, monovars, internalTypes);

      const effect = generateUniqueTVar();

      return {
        result: {
          ...expr,
          node: {
            ...expr.node,
            body: body.result,
            returning: returning.result
          },
          info: { type: returning.result.info.type, effect }
        },

        constraints: [
          ...body.constraints,
          ...returning.constraints,

          ...body.result.map(form => constEffect(form, effect)),
          constEffect(returning.result, effect)
        ],
        assumptions: [...body.assumptions, ...returning.assumptions]
      };
    }

    case "match": {
      const value = infer(expr.node.value, monovars, internalTypes);

      const cases = expr.node.cases.map(c => {
        return {
          ...c,
          infer: inferMany(
            c.body,
            [...monovars, c.variable.name],
            internalTypes
          )
        };
      });

      const t = generateUniqueTVar();
      const effect = generateUniqueTVar();

      const variantTypes = expr.node.cases.map(c => ({
        label: c.label,
        type: generateUniqueTVar()
      }));

      return {
        result: {
          ...expr,
          node: {
            ...expr.node,
            value: value.result,
            cases: cases.map(c => ({
              label: c.label,
              variable: c.variable,
              body: c.infer.result
            }))
          },
          info: {
            type: t,
            effect
          }
        },

        constraints: [
          ...value.constraints,
          ...flatMap(c => c.infer.constraints, cases),

          // Value must produce a value of type with all the variants
          // that `match` is handling.
          constEqual(value.result, tVariant(variantTypes)),

          ...flatMap(c => {
            const returningForm = last(c.infer.result);

            if (returningForm === undefined) {
              throw new InvariantViolation(`Missing returning form!`);
            }

            return [
              // Each case must return a value of the same type
              constEqual(returningForm, t),

              // The pattern variable of each case must be the same
              // type as the variant we are handling.
              ...flatMap(a => {
                if (a.node.name === c.variable.name) {
                  const variant = variantTypes.find(v => v.label === c.label);
                  if (!variant) {
                    throw new InvariantViolation(
                      `Unknown invariant case ${c.label}`
                    );
                  }
                  return [constEqual(a, variant.type)];
                } else {
                  return [];
                }
              }, c.infer.assumptions)
            ];
          }, cases)
        ],

        assumptions: [
          ...value.assumptions,
          ...flatMap(
            c =>
              c.infer.assumptions.filter(a => a.node.name !== c.variable.name),
            cases
          )
        ]
      };
    }
  }
}

function inferSyntax(
  syntax: Syntax,
  internalTypes: InternalTypeEnvironment
): InferResult<Syntax<Typed>> {
  if (isExpression(syntax)) {
    const { result, assumptions, constraints } = infer(
      { ...syntax, node: { ...syntax.node } },
      [],
      internalTypes
    );
    return {
      result,
      assumptions,
      constraints
    };
  } else if (syntax.node.tag === "definition") {
    const { result, assumptions, constraints } = infer(
      syntax.node.value,
      [],
      internalTypes
    );
    return {
      result: {
        ...syntax,
        node: {
          ...syntax.node,
          value: result
        }
      },
      assumptions,
      constraints
    };
  } else if (syntax.node.tag === "export") {
    return {
      result: {
        ...syntax,
        node: syntax.node
      },
      assumptions: [],
      constraints: []
    };
  } else if (syntax.node.tag === "type-alias") {
    return {
      result: {
        ...syntax,
        node: syntax.node
      },
      assumptions: [],
      constraints: []
    };
  } else {
    return assertNever(syntax.node);
  }
}

// Constraint solver
//
// Resolving a set of constraints means finding a Substitution that
// will satisfy all the constraints. This substitution can be applied
// to all temporary types introduced by the inference to the the
// "real" types.
//

// Before we solve the constraints, we have to get rid of the leftover
// assumptions. Those assumptions are from variables we have not
// found, so they are supposed to be part of a global environment (or
// non existing!).

export interface ExternalEnvironment {
  variables: {
    [v: string]: TypeSchema;
  };
  types: {
    [t: string]: Type;
  };
}

export interface InternalTypeEnvironment {
  [t: string]: Type;
}

export interface InternalEnvironment {
  variables: {
    [v: string]: Type;
  };
  types: InternalTypeEnvironment;
}

function lookupVariableType(
  varName: string,
  env: ExternalEnvironment
): TypeSchema | null {
  const t = env.variables[varName];
  if (t) {
    return t;
  } else if (isInlinePrimitive(varName)) {
    const prim = findInlinePrimitive(varName);
    return prim.type;
  } else {
    return null;
  }
}

// Generate constraints for those assumptions. Note that we generate
// explicit instance constraints, as it will allow us to have
// polymoprphic types in the environment.
function assumptionsToConstraints(
  assumptions: TAssumption[],
  env: ExternalEnvironment
): TConstraint[] {
  return maybeMap(a => {
    const t = lookupVariableType(a.node.name, env);
    return t && constExplicitInstance(a, t);
  }, assumptions);
}

function applySubstitutionToSyntax(
  s: Syntax<Typed>,
  env: Substitution
): Syntax<Typed> {
  if (isExpression(s)) {
    return applySubstitutionToExpr(s, env);
  } else if (s.node.tag === "definition") {
    return {
      ...s,
      node: {
        ...s.node,
        value: applySubstitutionToExpr(s.node.value, env)
      }
    };
  } else if (s.node.tag === "export") {
    return s;
  } else if (s.node.tag === "type-alias") {
    return s;
  } else {
    return assertNever(s.node);
  }
}

const defaultEnvironment: ExternalEnvironment = {
  variables: mapObject(primitives, prim => prim.type),
  types: {}
};

export function inferType(
  expr: Expression,
  env: ExternalEnvironment = defaultEnvironment,
  internalTypes: InternalTypeEnvironment
): Expression<Typed> {
  const { result: tmpExpr, constraints, assumptions } = infer(
    expr,
    [],
    internalTypes
  );

  const s = solve(
    [...constraints, ...assumptionsToConstraints(assumptions, env)],
    {}
  );

  return applySubstitutionToExpr(tmpExpr, s);
}

// Group the gathered assumptions and classify them into:
//
// - internals: The variable referes to a variable defined in this module.
// - externals: The variable referes to an imported module.
// - unknown: The variable does not refer to anything known.
//
function groupAssumptions(
  assumptions: TAssumption[],
  internalEnv: InternalEnvironment,
  externalEnv: ExternalEnvironment
): {
  internals: TAssumption[];
  externals: TAssumption[];
  unknowns: TAssumption[];
} {
  const internals = assumptions.filter(
    v => v.node.name in internalEnv.variables
  );
  const externals = assumptions.filter(
    v => lookupVariableType(v.node.name, externalEnv) !== null
  );
  return {
    internals,
    externals,
    unknowns: difference(assumptions, [...internals, ...externals])
  };
}

/** Check that there is no cycles in env, throwing an error otherwise. */
function checkCircularTypes(allTypeAliases: STypeAlias[]) {
  // The type aliases reference each other and then form a directed
  // graph. Here we do a simple depth-first search, keeping track of
  // the path to report if we find any cycles.
  function visit(typeAlias: STypeAlias, path: STypeAlias[]) {
    const index = path.indexOf(typeAlias);
    if (index < 0) {
      listTypeConstants(typeAlias.node.definition)
        .map(ud => {
          return allTypeAliases.find(x => x.node.alias.name === ud.node.name);
        })
        .forEach(dep => {
          if (!dep) {
            return;
          }
          visit(dep, [...path, typeAlias]);
        });
    } else {
      // the current node is reachable from itself. We can report a
      // cycle here.
      const cycle = [...path.slice(index), typeAlias];
      if (cycle.length === 1) {
        throw new Error(
          printHighlightedExpr(
            `Recursive type aliases are not allowed.`,
            typeAlias.location
          )
        );
      } else {
        throw new Error(
          printHighlightedExpr(
            `Cicular dependency in type aliases found
  ${cycle.map(s => s.node.alias.name).join(" -> ")}
`,
            typeAlias.location
          )
        );
      }
    }
  }

  allTypeAliases.forEach(tAlias => visit(tAlias, []));
}

/** Expand known type aliases from a monotype. */
function expandTypeAliases(type: Type, env: InternalTypeEnvironment): Type {
  return transformRecurType(type, t => {
    if (t.node.tag == "constant") {
      const def = env[t.node.name];
      return def ? expandTypeAliases(def, env) : t;
    } else return t;
  });
}

/** Run the type inference on a module.
 *
 * @description Takes a Module and the external environment, will run
 * inference returning the same module with the types annotated in the
 * AST. Additionally, a set of unknown references is returned so those
 * can be reported.
 */
export function inferModule(
  m: Module,
  externalEnv: ExternalEnvironment = defaultEnvironment
): {
  typedModule: Module<Typed>;
  unknowns: TAssumption[];
} {
  checkCircularTypes(m.body.filter(isTypeAlias));
  const internalTypes: InternalTypeEnvironment = m.body.reduce((env, s) => {
    if (s.node.tag === "type-alias") {
      return { ...env, [s.node.alias.name]: s.node.definition };
    } else {
      return env;
    }
  }, {});

  const bodyInferences = m.body.map(form => inferSyntax(form, internalTypes));
  const body = bodyInferences.map(i => i.result);

  const internalEnv: InternalEnvironment = {
    variables: body.reduce((env, s) => {
      if (s.node.tag === "definition") {
        return { ...env, [s.node.variable.name]: s.node.value.info.type };
      } else {
        return env;
      }
    }, {}),

    types: internalTypes
  };

  const assumptions = groupAssumptions(
    flatMap(i => i.assumptions, bodyInferences),
    internalEnv,
    externalEnv
  );

  const constraints: TConstraint[] = [
    ...flatMap(i => i.constraints, bodyInferences),

    ...assumptionsToConstraints(assumptions.externals, externalEnv),

    ...assumptions.internals.map(v =>
      constImplicitInstance(v, [], internalEnv.variables[v.node.name])
    )
  ];

  const solution = solve(constraints, {});

  return {
    typedModule: {
      ...m,
      body: body.map(s => applySubstitutionToSyntax(s, solution))
    },
    unknowns: assumptions.unknowns.map(
      (v): TAssumption => {
        return applySubstitutionToExpr(v, solution) as SVariableReference<
          Typed
        >;
      }
    )
  };
}
