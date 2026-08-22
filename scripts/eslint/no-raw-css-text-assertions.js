/**
 * Prevent style tests from asserting against the formatting of raw CSS text.
 *
 * This rule is intentionally narrow: it follows variables initialized from
 * readFileSync/readStylesheet calls whose path ends in `.css`, and rejects only
 * Vitest/Jest `toMatch` and `toContain` assertions over that raw value. Other
 * source-text contract tests remain outside its scope.
 */
const rawMatchers = new Set(["toMatch", "toContain"]);

function propertyName(member) {
  if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
  if (member.computed && member.property.type === "Literal") {
    return typeof member.property.value === "string" ? member.property.value : undefined;
  }
  return undefined;
}

function containsCssPath(node) {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (node.type === "Literal") {
    return typeof node.value === "string" && /\.css(?:$|[?#])/.test(node.value);
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.some((quasi) => /\.css(?:$|[?#])/.test(quasi.value.cooked ?? quasi.value.raw));
  }
  if (node.type === "CallExpression") {
    return node.arguments.some((argument) => argument.type !== "SpreadElement" && containsCssPath(argument));
  }
  if (node.type === "BinaryExpression") {
    return containsCssPath(node.left) || containsCssPath(node.right);
  }
  return false;
}

function isCssReadCall(node) {
  if (node.type !== "CallExpression") {
    return false;
  }
  const readerName = node.callee.type === "Identifier" ? node.callee.name : propertyName(node.callee);
  if (readerName !== "readFileSync" && readerName !== "readStylesheet") {
    return false;
  }
  return node.arguments.some((argument) => argument.type !== "SpreadElement" && containsCssPath(argument));
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

    const isRawCssExpression = (node) => {
      if (isCssReadCall(node)) {
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
      VariableDeclarator(node) {
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
