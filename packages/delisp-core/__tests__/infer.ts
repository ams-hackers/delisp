import { isDeclaration, readSyntax } from "../src/index";
import {
  ExternalEnvironment,
  inferType,
  InternalTypeEnvironment
} from "../src/infer";
import { readType } from "../src/convert-type";
import { printType } from "../src/type-printer";

function typeOf(
  str: string,
  externalEnv: ExternalEnvironment = { variables: {}, types: {} },
  internalEnv: InternalTypeEnvironment = {}
): string {
  const syntax = readSyntax(str);
  if (isDeclaration(syntax)) {
    throw new Error(`Not an expression!`);
  }
  const typedExpr = inferType(syntax, externalEnv, internalEnv);
  return printType(typedExpr.info.type);
}

describe("Type inference", () => {
  describe("Numbers", () => {
    it("should self-evaluate", () => {
      expect(typeOf("0")).toBe("number");
      expect(typeOf("1")).toBe("number");
      expect(typeOf("-1")).toBe("number");
    });
  });

  describe("Strings", () => {
    it("should self-evaluate", () => {
      expect(typeOf('""')).toBe("string");
      expect(typeOf('"foo"')).toBe("string");
      expect(typeOf('"a\\nb"')).toBe("string");
    });
  });

  describe("Function calls", () => {
    it("should have the right type", () => {
      const env = {
        variables: {
          length: readType("(-> string _ int)"),
          "+": readType("(-> number number _ number)"),
          const: readType("(-> a _ (-> b _ a))")
        },
        types: {}
      };
      expect(typeOf("(+ 1 2)", env)).toBe("number");
      expect(typeOf("(+ (+ 1 1) 2)", env)).toBe("number");
      expect(typeOf("(lambda (x) (+ x 1))", env)).toBe("(-> number α number)");
      expect(typeOf("(const 5)", env)).toBe("(-> α β number)");
      expect(typeOf(`((const 5) "foo")`, env)).toBe("number");
      expect(typeOf(`(+ ((const 5) "foo") ((const 5) 23))`, env)).toBe(
        "number"
      );

      expect(() => typeOf(`(+ "foo" 3`)).toThrow();
    });

    describe("Lambda abstractions", () => {
      it("should infer the right type", () => {
        expect(typeOf("(lambda (x) x)")).toBe("(-> α β α)");
        expect(typeOf("(lambda (x y) y)")).toBe("(-> α β γ β)");
        expect(typeOf("(lambda (f x) (f x))")).toBe("(-> (-> α β γ) α β γ)");
        expect(typeOf("(lambda (x) (lambda (y) x))")).toBe(
          "(-> α β (-> γ δ α))"
        );
        // lambda-bound variables should be monomorphic
        expect(() => typeOf(`(lambda (f) ((f "foo") (f 0)))`)).toThrow();
      });

      it("should return the type of the last form", () => {
        expect(typeOf("(lambda (x) 1)")).toBe("(-> α β number)");
      });
    });

    describe("Let polymorphism", () => {
      it("should generalize basic types in let", () => {
        expect(typeOf("(let {id (lambda (x) x)} id)")).toBe("(-> α β α)");
      });

      it("should shadow inline primitivres", () => {
        expect(typeOf("(let {+ 10} +)")).toBe("number");
      });
    });

    describe("Lists", () => {
      it("should infer the type of empty vector", () => {
        expect(typeOf("[]")).toBe("[α]");
      });
      it("should infer the type of a vector of numbers", () => {
        expect(typeOf("[1 2 3]")).toBe("[number]");
      });
      it("should infer the type of nested vectors", () => {
        expect(typeOf("[[1] [2] [3]]")).toBe("[[number]]");
      });
    });

    describe("Records", () => {
      it("should infer the type of exact records", () => {
        expect(typeOf('{:x 10 :y "hello"}')).toBe("{:x number :y string}");
      });
      it("should infer the type of a field selector", () => {
        expect(typeOf(":x")).toBe("(-> {:x α | β} γ α)");
        expect(typeOf(":foo")).toBe("(-> {:foo α | β} γ α)");
        expect(typeOf("(if true :x :y)")).toBe("(-> {:x α :y α | β} γ α)");
      });
      it("should be able to access the field", () => {
        expect(typeOf("(:x {:x 5})")).toBe("number");
        expect(typeOf("(lambda (f) (f {:x 5 :y 6}))")).toBe(
          "(-> (-> {:x number :y number} α β) α β)"
        );
      });
      it("should throw an error when trying to access unknown fields", () => {
        expect(() => typeOf("(:x {:y 2})")).toThrow();
        expect(() => typeOf("(:x {})")).toThrow();
      });
      it("should infer the type of updating record fields", () => {
        expect(typeOf("{:x 2 | {:x 1}}")).toBe("{:x number}");
        expect(typeOf('{:x "foo" | {:x 1}}')).toBe("{:x string}");
        expect(typeOf("{:x 3 | (if true {:x 1} {:x 2})}")).toBe("{:x number}");
        expect(typeOf("(lambda (r v) {:x v | r})")).toBe(
          "(-> {:x α | β} γ δ {:x γ | β})"
        );
      });
      it("should not allow to extend a record", () => {
        expect(() => typeOf("{:y 2 | {:x 1}}")).toThrow();
      });
      it("should not allow to extend any other type", () => {
        expect(() => typeOf("{:x 1 | 5}")).toThrow();
        expect(() => typeOf('{:x 1 | "foo"}')).toThrow();
      });
    });

    describe("Conditionals", () => {
      it("should infer the right type when both branches return the same type", () => {
        expect(typeOf("(if true 1 0)")).toBe("number");
      });
      it("should ensure both branches' types are instantiated properly", () => {
        expect(typeOf("(if true [] [1])")).toBe("[number]");
      });
    });

    describe("Type annotations", () => {
      it("user-specified variables can specialize inferred types", () => {
        expect(typeOf("(the [number] [])")).toBe("[number]");
      });

      it("user-specified variables can be isomorphic to inferred types", () => {
        expect(typeOf("(the [a] [])")).toBe("[α]");
      });

      it("user-specified variables cannot generalize inferred types", () => {
        expect(() => typeOf(`(the a 3)`)).toThrow();
        expect(() =>
          typeOf(`(the (-> a a) (the (-> string string) (lambda (x) x)))`)
        ).toThrow();
      });

      it("supports partial type annotations", () => {
        expect(typeOf('(the [_a] ["foo"])')).toBe("[string]");
        expect(typeOf("(the (-> _a _ _b) (lambda (x) 42))")).toBe(
          "(-> α β number)"
        );
        expect(typeOf("(the (-> _a _ _b) (lambda (x) (+ x 42)))")).toBe(
          "(-> number α number)"
        );

        expect(typeOf(`(lambda (f) ((the (-> _a _b _c _d) f) 42 "foo"))`)).toBe(
          "(-> (-> number string α β) α β)"
        );
        expect(() =>
          typeOf(`(lambda (f) ((the (-> _a _a _ _c) f) 42 "foo"))`)
        ).toThrow();

        expect(typeOf(`(lambda (f) ((the (-> _ _ _e _) f) 42 "foo"))`)).toBe(
          "(-> (-> number string α β) α β)"
        );
      });

      it.skip("`_` should not be equal to any named wildcard _<name>", () => {
        expect(typeOf(`(the (-> _ __t1) (lambda (x) (print x) 42))`)).toBe(
          "(-> string number)"
        );
      });
    });

    describe("User-defined type", () => {
      const env = { variables: {}, types: { ID: readType("number").mono } };

      it("should NOT be compatible", () => {
        expect(() => typeOf("(if true (the ID 5) 3)", env)).toThrow();
      });

      it("should NOT expand to their definition", () => {
        expect(typeOf("(lambda (x) (the ID x))", env)).toBe("(-> ID α ID)");
      });
    });

    describe("Type aliases", () => {
      const env = { variables: {}, types: {} };
      const intEnv: InternalTypeEnvironment = {
        ID: readType("number").mono,
        Person: readType("{:name string}").mono
      };

      it("should be compatible if they are internal", () => {
        expect(typeOf("(if true (the ID 5) 3)", env, intEnv)).not.toBe("α");
      });

      it("should expand to their definition if they are internal", () => {
        expect(typeOf("(the ID 5)", env, intEnv)).toBe("number");
      });

      it("should be compatible when defined as a record", () => {
        expect(typeOf('(the Person {:name "david"})', env, intEnv)).toBe(
          "{:name string}"
        );
      });
    });

    describe("Do blocks", () => {
      it("type is the type of the last form", () => {
        expect(typeOf("(do 1 2 3)")).toBe("number");
      });
      it("constraint types properly", () => {
        expect(typeOf("(lambda (x) (print x) x)")).toBe(
          "(-> string (effect console | α) string)"
        );
      });
    });

    describe("Recursion", () => {
      it("type is inferred for simple functions", () => {
        expect(
          typeOf(`
(let {f (lambda (n)
          (if (= n 0)
              1
              (* n (f (- n 1)))))}
  f)
`)
        ).toBe("(-> number α number)");
      });

      it("basic polymorphic function on lists should work", () => {
        const env = {
          variables: {
            "empty?": readType("(-> [a] _ boolean)"),
            "+": readType("(-> number number _ number)"),
            rest: readType("(-> [a] (effect exp | _) [a])")
          },
          types: {}
        };

        expect(
          typeOf(
            `
          (let {f (lambda (l)
                    (if (empty? l)
                        0
                        (+ 1 (f (rest l)))))}
            f)
          `,
            env
          )
        ).toBe("(-> [α] (effect exp | β) number)");
      });
    });
  });

  describe("Effects", () => {
    it("should infer the effect with let bindings bounded to some monomorphic function call", () => {
      expect(
        typeOf(
          `
(lambda (f)
  (let {x (f)}
    x))
`
        )
      ).toBe("(-> (-> (effect) α) β α)");
    });
  });
});
