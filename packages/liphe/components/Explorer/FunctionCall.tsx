import * as Delisp from "@delisp/core";
import { Typed } from "@delisp/core";
import * as React from "react";
import { ExpressionExplorer } from "./Expression";
import { Cursor } from "./common";
import styles from "./FunctionCall.module.css";
import classnames from "classnames/bind";

const cn = classnames.bind(styles);

export const FunctionCallExplorer: React.FC<{
  cursor: Cursor<Delisp.SFunctionCall<Typed>>;
}> = ({ cursor }) => {
  const call = cursor.value;
  const argCursor = cursor.prop("node").prop("arguments");
  return (
    <div className={styles.functionCall}>
      <div className={styles.function}>
        <ExpressionExplorer cursor={cursor.prop("node").prop("fn")} />
      </div>
      <div
        className={cn("argumentList", {
          longList: call.node.arguments.length > 5,
        })}
      >
        {Cursor.map(argCursor, (c, ix) => {
          return (
            ix > 0 && (
              <div className={cn("argument")} key={ix}>
                <ExpressionExplorer cursor={c} />
              </div>
            )
          );
        }).slice(1)}
      </div>
    </div>
  );
};