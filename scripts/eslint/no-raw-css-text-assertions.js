/**
 * Keep stylesheet assertions at the token-policy seam. Layout belongs in the
 * browser; parser fixtures and source-ownership checks are separate contracts.
 */
const declarationQueries = new Set(["declarationsFor", "declarationFor"]);
const textTransforms = new Set(["includes", "match", "replace", "replaceAll", "slice", "split", "trim", "test", "parseInt", "parseFloat"]);
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
  if (call.callee.type !== "MemberExpression") {
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
      description: "require rendered checks instead of stylesheet declaration assertions"
    },
    schema: [],
    messages: {
      rawCssAssertion: "Use behavior or rendered geometry instead of matching raw stylesheet text.",
      declarationAssertion: "Use behavior or rendered geometry; only token-policy assertions may compare stylesheet declarations."
    }
  },
  create(context) {
    const cssPathVariables = new WeakSet();
    const rawCssVariables = new WeakSet();
    const declarationVariables = new WeakSet();
    const importedNames = new WeakMap();

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

    const resolvedCallName = (node) => node.callee.type === "Identifier"
      ? importedNames.get(resolveVariable(node.callee)) ?? callName(node)
      : callName(node);

    const derivedFrom = (node, predicate) => {
      if (node.type === "MemberExpression") return predicate(node.object);
      if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
        return predicate(node.left) || predicate(node.right);
      }
      if (node.type === "TemplateLiteral") return node.expressions.some(predicate);
      if (node.type === "CallExpression" && textTransforms.has(resolvedCallName(node))) {
        return (node.callee.type === "MemberExpression" && predicate(node.callee.object))
          || node.arguments.some((argument) => argument.type !== "SpreadElement" && predicate(argument));
      }
      return false;
    };

    const isRawCssExpression = (node) => {
      if (isCssReadCall(node, isCssPathVariable)
        || (node.type === "CallExpression" && resolvedCallName(node) === "readStylesheet")) {
        return true;
      }
      if (node.type === "Identifier") {
        const variable = resolveVariable(node);
        return variable ? rawCssVariables.has(variable) : false;
      }
      return derivedFrom(node, isRawCssExpression);
    };

    const isDeclarationExpression = (node) => {
      if (node.type === "Identifier") {
        const variable = resolveVariable(node);
        return variable ? declarationVariables.has(variable) : false;
      }
      if (node.type === "MemberExpression") {
        if (propertyName(node)?.startsWith("--")) return false;
        return isDeclarationExpression(node.object);
      }
      if (node.type === "CallExpression" && declarationQueries.has(resolvedCallName(node))) {
        if (node.arguments[1]?.type === "Literal" && node.arguments[1].value === ":root") return false;
        const property = node.arguments[2];
        if (resolvedCallName(node) === "declarationFor" && property?.type === "Literal"
          && typeof property.value === "string" && property.value.startsWith("--")) return false;
        return node.arguments[0] && isRawCssExpression(node.arguments[0]);
      }
      return derivedFrom(node, isDeclarationExpression);
    };

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          for (const variable of context.sourceCode.getDeclaredVariables(node).filter((entry) => entry.name === specifier.local.name)) {
            if (specifier.type === "ImportSpecifier") importedNames.set(variable, specifier.imported.name ?? specifier.imported.value);
            if (specifier.type === "ImportDefaultSpecifier" && /\.css\?raw(?:$|&)/.test(node.source.value)) rawCssVariables.add(variable);
          }
        }
      },
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
        const rightIsDeclaration = isDeclarationExpression(node.right);

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
        if (rightIsDeclaration) declarationVariables.add(variable);
        else declarationVariables.delete(variable);
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
        if (node.id.type === "Identifier" && node.init && isDeclarationExpression(node.init)) {
          for (const variable of context.sourceCode.getDeclaredVariables(node)) {
            declarationVariables.add(variable);
          }
        }
      },
      CallExpression(node) {
        const value = assertedValue(node);
        if (value && isRawCssExpression(value)) {
          context.report({ node, messageId: "rawCssAssertion" });
        }
        const expected = node.arguments[0];
        const tokenPolicy = expected?.type === "Literal" && (
          (typeof expected.value === "string" && expected.value.includes("var(--"))
          || (expected.regex?.pattern.startsWith("^var") && expected.regex.pattern.includes("--"))
        );
        if (value && !tokenPolicy && isDeclarationExpression(value)) {
          context.report({ node, messageId: "declarationAssertion" });
        }
      }
    };
  }
};
