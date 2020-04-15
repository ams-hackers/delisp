import * as Delisp from "@delisp/core";
import { Typed } from "@delisp/core";
import * as React from "react";
import { DetailedFunctionExplorer } from "./Function";
import { ExpressionExplorer } from "./Expression";
import { TypeExplorer } from "./Type";
import { Cursor } from "./common";
import styles from "./Definition.module.css";

const DefinitionValueExplorer: React.FC<{
  cursor: Cursor<Delisp.Expression<Typed>>;
}> = ({ cursor }) => {
  const value = cursor.value;
  if (value.node.tag === "function") {
    return (
      <DetailedFunctionExplorer
        cursor={cursor as Cursor<Delisp.SFunction<Typed>>}
      />
    );
  } else {
    return <ExpressionExplorer cursor={cursor} />;
  }
};

const DefinitionValueKindExplorer: React.FC<{
  value: Delisp.Expression<Typed>;
}> = ({ value }) => {
  if (value.node.tag === "function") {
    return <span>λ</span>;
  } else {
    return <TypeExplorer type={value.info.selfType} />;
  }
};

export const DefinitionExplorer: React.FC<{
  cursor: Cursor<Delisp.SDefinition<Typed>>;
}> = ({ cursor }) => {
  const definition = cursor.value;
  return (
    <div className={styles.definition}>
      <span className={styles.definitionLabel}>
        {definition.node.variable.name}
      </span>
      <span className={styles.definitionType}>
        <DefinitionValueKindExplorer value={definition.node.value} />
      </span>
      <DefinitionValueExplorer cursor={cursor.prop("node").prop("value")} />
    </div>
  );
};