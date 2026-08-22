/**
 * Prevent style tests from asserting against the formatting of raw CSS text.
 *
 * This rule is intentionally narrow: it follows scope-bound static CSS paths
 * and values initialized or directly assigned from readFileSync/readStylesheet,
 * then rejects only Vitest/Jest `toMatch` and `toContain` assertions over that
 * raw value. Other source-text contract tests remain outside its scope.
 */
const rawMatchers = new Set(["toMatch", "toContain"]);
const pathBuilders = new Set(["join", "resolve"]);

function propertyName(member) {
  if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
  if (member.computed && member.property.type === "Literal") {
    return typeof member.property.value === "string" ? member.property.value : undefined;
  }
  return undefined;
}

function callName(node) {
  if (node.callee.type === "Identifier") {
    return node.callee.name;
  }
  if (node.callee.type === "MemberExpression") {
    return propertyName(node.callee);
  }
  return undefined;
}

function containsCssPath(node, isCssPathVariable = () => false) {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (node.type === "Literal") {
    return typeof node.value === "string" && /\.css(?:$|[?#])/.test(node.value);
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.some((quasi) => /\.css(?:$|[?#])/.test(quasi.value.cooked ?? quasi.value.raw));
  }
  if (node.type === "Identifier") {
    return isCssPathVariable(node);
  }
  if (node.type === "CallExpression" && pathBuilders.has(callName(node))) {
    return node.arguments.some(
      (argument) => argument.type !== "SpreadElement" && containsCssPath(argument, isCssPathVariable)
    );
  }
  if (node.type === "BinaryExpression") {
    return containsCssPath(node.left, isCssPathVariable) || containsCssPath(node.right, isCssPathVariable);
  }
  return false;
}

function isCssReadCall(node, isCssPathVariable) {
  if (node.type !== "CallExpression") {
    return false;
  }
  const readerName = callName(node);
  if (readerName !== "readFileSync" && readerName !== "readStylesheet") {
    return false;
  }
  return node.arguments.some(
    (argument) => argument.type !== "SpreadElement" && containsCssPath(argument, isCssPathVariable)
  );
}

function isStraightLineAssignment(node) {
  if (node.parent?.type !== "ExpressionStatement") {
    return false;
  }
  const container = node.parent.parent;
  if (container?.type === "Program") {
    return true;
  }
  if (container?.type !== "BlockStatement") {
    return false;
  }
  return ["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"].includes(container.parent?.type);
}

function assertedValue(call) {
  if (call.callee.type !== "MemberExpression" || !rawMatchers.has(propertyName(call.callee))) {
    return undefined;
  }

  let expectation = call.callee.object;
  if (expectation.type === "MemberExpression" && propertyName(expectation) === "not") {
    expectation = expectation.object;
  }
  if (
    expectation.type !== "CallExpression"
    || expectation.callee.type !== "Identifier"
    || expectation.callee.name !== "expect"
  ) {
    return undefined;
  }
  const [value] = expectation.arguments;
  return value?.type === "SpreadElement" ? undefined : value;
}

export const noRawCssTextAssertions = {
  meta: {
    type: "problem",
    docs: {
      description: "require structural helpers for assertions over CSS files"
    },
    schema: [],
    messages: {
      rawCssAssertion: "Assert CSS through src/test/cssAssertions instead of matching raw stylesheet text."
    }
  },
  create(context) {
    const cssPathVariables = new WeakSet();
    const rawCssVariables = new WeakSet();

    const resolveVariable = (identifier) => {
      let scope = context.sourceCode.getScope(identifier);
      while (scope) {
        const variable = scope.set.get(identifier.name);
        if (variable) {
          return variable;
        }
        scope = scope.upper;
      }
      return undefined;
    };

    const isCssPathVariable = (identifier) => {
      const variable = resolveVariable(identifier);
      return variable ? cssPathVariables.has(variable) : false;
    };

    const isStaticCssPathExpression = (node) => containsCssPath(node, isCssPathVariable);

    const isRawCssExpression = (node) => {
      if (isCssReadCall(node, isCssPathVariable)) {
        return true;
      }
      if (node.type === "Identifier") {
        const variable = resolveVariable(node);
        return variable ? rawCssVariables.has(variable) : false;
      }
      if (node.type === "BinaryExpression" && node.operator === "+") {
        return isRawCssExpression(node.left) || isRawCssExpression(node.right);
      }
      return false;
    };

    return {
      AssignmentExpression(node) {
        if (node.operator !== "=" || node.left.type !== "Identifier" || !isStraightLineAssignment(node)) {
          return;
        }
        const variable = resolveVariable(node.left);
        if (!variable) {
          return;
        }

        const rightIsStaticCssPath = isStaticCssPathExpression(node.right);
        const rightIsRawCss = isRawCssExpression(node.right);

        if (rightIsStaticCssPath) {
          cssPathVariables.add(variable);
        } else {
          cssPathVariables.delete(variable);
        }
        if (rightIsRawCss) {
          rawCssVariables.add(variable);
        } else {
          rawCssVariables.delete(variable);
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.init && isStaticCssPathExpression(node.init)) {
          for (const variable of context.sourceCode.getDeclaredVariables(node)) {
            cssPathVariables.add(variable);
          }
        }
        if (node.id.type === "Identifier" && node.init && isRawCssExpression(node.init)) {
          for (const variable of context.sourceCode.getDeclaredVariables(node)) {
            rawCssVariables.add(variable);
          }
        }
      },
      CallExpression(node) {
        const value = assertedValue(node);
        if (value && isRawCssExpression(value)) {
          context.report({ node, messageId: "rawCssAssertion" });
        }
      }
    };
  }
};
