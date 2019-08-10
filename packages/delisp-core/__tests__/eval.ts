import { moduleEnvironment } from "../src/compiler";
import { createSandbox, evaluate } from "../src/eval";
import { readSyntax } from "../src/index";
import { macroexpandSyntax } from "../src/index";
import { createModule } from "../src/module";
import * as S from "../src/syntax";
import { inferExpressionInModule } from "../src/infer";

function evaluateString(str: string): unknown {
  const env = moduleEnvironment(createModule(), {
    getOutputFile(name) {
      return name;
    }
  });
  const s = macroexpandSyntax(readSyntax(`(let {*context* {}} ${str})`));
  const sandbox = createSandbox(() => null);
  if (!S.isExpression(s)) {
    throw new Error(`Can't evaluate a non-expression!`);
  }
  const { typedExpression } = inferExpressionInModule(
    s,
    createModule(),
    undefined,
    false
  );
  return evaluate(typedExpression, env, sandbox);
}

describe("Evaluation", () => {
  describe("Booleans", () => {
    it("should self-evaluate", () => {
      expect(evaluateString("true")).toBe(true);
      expect(evaluateString("false")).toBe(false);
    });
  });

  describe("Numbers", () => {
    it("should self-evaluate", () => {
      expect(evaluateString("0")).toBe(0);
      expect(evaluateString("1")).toBe(1);
      expect(evaluateString("-1")).toBe(-1);
    });
  });

  describe("Strings", () => {
    it("should self-evaluate", () => {
      expect(evaluateString('""')).toBe("");
      expect(evaluateString('"foo"')).toBe("foo");
      expect(evaluateString('"a\\nb"')).toBe("a\nb");
    });
  });

  describe("Function calls", () => {
    it("should evaluate to the right value", () => {
      expect(evaluateString("(+ 1 2)")).toBe(3);
      expect(evaluateString("(+ (+ 1 1) 2)")).toBe(4);
    });
  });

  describe("Lambda abstractions", () => {
    it("should be able to be called", () => {
      expect(evaluateString("((lambda (x y) y) 4 5)")).toBe(5);
    });

    it("should return records as objects", () => {
      expect(evaluateString("((lambda (x) {:x x}) 10)")).toEqual({ x: 10 });
    });

    it("should return the last expression of the body", () => {
      expect(evaluateString("((lambda (x) x 1) 10)")).toBe(1);
      expect(evaluateString("((lambda (x) x {:a 1}) 10)")).toEqual({ a: 1 });
    });

    // Regression
    it("different argument names should not shadow", () => {
      expect(
        evaluateString(`
((lambda (x)
  ((lambda (y) x) 11))
 33)
`)
      ).toBe(33);
    });
  });

  describe("Let bindings", () => {
    it("should evaluate to the right value", () => {
      expect(evaluateString("(let {} 5)")).toBe(5);
      expect(evaluateString("(let {x 5} x)")).toBe(5);
      expect(evaluateString("(let {x 4 y 6} (+ x y))")).toBe(10);
      expect(
        evaluateString(`
(let {const (lambda (x)
              (lambda (y) x))}
  (+ ((const 10) "foo")
     ((const 20) 42)))
`)
      ).toBe(30);
    });

    it("inner lets should shadow outer ones", () => {
      expect(evaluateString("(let {x 5} (let {x 1} x))")).toBe(1);
    });

    it("should shadow inline primitives", () => {
      expect(evaluateString("(let {+ 10} +)")).toBe(10);
    });
  });

  describe("lists", () => {
    it("basic list operations work", () => {
      expect(evaluateString("(empty? [])")).toBe(true);
      expect(evaluateString("(not (empty? (cons 1 [])))")).toBe(true);
      // expect(evaluateString("(first (cons 1 []))")).toBe(1);
      expect(evaluateString("(rest (cons 1 []))")).toEqual([]);
    });
  });

  describe("conditionals", () => {
    it("simple conditionals evaluate correctly", () => {
      expect(evaluateString("(if true 1 2)")).toBe(1);
      expect(evaluateString("(if false 1 2)")).toBe(2);
    });
  });

  describe("Primitives", () => {
    it("map", () => {
      expect(evaluateString("(map (lambda (x) (+ x x)) [1 2 3 4])")).toEqual([
        2,
        4,
        6,
        8
      ]);
    });

    it("filter", () => {
      expect(
        evaluateString("(filter (lambda (x) (< 0 x)) [-2 -1 0 1 2])")
      ).toEqual([1, 2]);
    });

    it("fold", () => {
      expect(evaluateString("(fold + [1 2 3 4] 0)")).toEqual(10);
    });
  });

  describe("Records", () => {
    it("should construct records", () => {
      expect(evaluateString("{:x 2 :y 8}")).toEqual({ x: 2, y: 8 });
    });
    it("should access record fields", () => {
      expect(evaluateString("(:foo {:bar 3 :foo 5 :baz 2})")).toEqual(5);
    });
    it("should update records", () => {
      expect(evaluateString("{:x 2 | {:x 1}}")).toEqual({ x: 2 });
      expect(evaluateString("{:x 3 | {:x 1 :y 2}}")).toEqual({ x: 3, y: 2 });
    });
  });

  describe("Do blocks", () => {
    it("should evaluate to the last form", () => {
      expect(evaluateString(`(do 1)`)).toBe(1);
      expect(evaluateString(`(do 1 2)`)).toBe(2);
    });
  });

  describe("Multiple values", () => {
    it("uses the primary value by default", () => {
      expect(evaluateString(`(+ 1 (values 2 10))`)).toBe(3);
      expect(evaluateString(`(+ (values 1) (values 2 10))`)).toBe(3);
    });

    it("multiple-value-bind can catch forms with a single value transparently", () => {
      expect(evaluateString(`(multiple-value-bind (x) 3 (+ x 1))`)).toBe(4);
    });

    it("multiple-value-bind can catch forms with a multiple values", () => {
      expect(
        evaluateString(`(multiple-value-bind (x y) (values 3 7) (+ x y))`)
      ).toBe(10);
    });
  });

  describe("Context argument", () => {
    it("should work across functions", () => {
      expect(
        evaluateString(`
(let {f (lambda () *context*)}
  (let {*context* 10}
  (f)))`)
      ).toBe(10);
    });
  });

  describe("Match and case", () => {
    it("should do basic pattern matching", () => {
      expect(
        evaluateString(`
(match (case :increase 10)
  ({:increase x} (+ x 1))
  ({:decrease x} (- x 1)))`)
      ).toBe(11);

      expect(
        evaluateString(`
(match (case :decrease 10)
  ({:increase x} (+ x 1))
  ({:decrease x} (- x 1)))`)
      ).toBe(9);
    });
  });
});
