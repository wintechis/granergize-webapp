// Custom ESLint rule: a file's name must match what it *is*, by inspecting its
// content (not a fixed per-directory case):
//
//   PascalCase  ⟺  the file defines a React **component** — a PascalCase-named (or
//                  default-exported) function that returns JSX, or an imperative
//                  component default-exported under a PascalCase name (returns
//                  `null`, e.g. a Leaflet layer) — OR it is an **intent core**
//                  (under `intents/cores/`, named after the catalog verb).
//   camelCase   ⟺  a **module of functions/values**: no component defined. This
//                  holds even when the file exports PascalCase *types* or error
//                  *classes* (`SessionExpiredError`) or returns JSX from a
//                  camelCase helper (`makeBuildingFields`) — none of those is a
//                  component, so the file stays a value-module.
//
// Content-aware, so it catches a function-module wearing a PascalCase name (the
// `TurtleParsingService` outlier) — which a path/extension rule can't. Entry points
// (`main`/`index`) are exempt (lowercase by universal convention even when they host
// the root component).
const isPascalName = (n) => /^[A-Z]/.test(n) && /[a-z]/.test(n) && !n.includes("_");

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Filename case must match the principal export: PascalCase for React components / intent cores, camelCase for function/value modules.",
    },
    schema: [],
  },
  create(context) {
    const path = (context.filename || context.getFilename()).replace(/\\/g, "/");
    const stem = path.split("/").pop().replace(/\.(ts|tsx)$/, "");
    if (stem === "main" || stem === "index") return {}; // entry points: lowercase by convention
    const fileIsPascal = /^[A-Z]/.test(stem);
    const underCores = path.includes("/intents/cores/"); // named after the catalog verb
    // Is this JSX inside a PascalCase-named (or default-exported) function? → a React
    // COMPONENT, vs JSX returned by a camelCase helper (which stays a value-module).
    const enclosedInComponent = (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (p.type === "FunctionDeclaration") {
          if (p.id && isPascalName(p.id.name)) return true;
          if (p.parent && p.parent.type === "ExportDefaultDeclaration") return true;
        } else if (
          p.type === "ArrowFunctionExpression" || p.type === "FunctionExpression"
        ) {
          const gp = p.parent;
          if (
            gp && gp.type === "VariableDeclarator" &&
            gp.id.type === "Identifier" && isPascalName(gp.id.name)
          ) return true;
          if (gp && gp.type === "ExportDefaultDeclaration") return true;
        }
      }
      return false;
    };
    let hasComponent = false;
    let hasPascalDefault = false;
    return {
      // A default-exported PascalCase function/class/identifier is a component too —
      // catches imperative components returning `null` (no JSX). `export default theme`
      // (a camelCase value) does NOT match.
      ExportDefaultDeclaration(node) {
        const d = node.declaration;
        const name = (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration")
          ? d.id && d.id.name
          : d.type === "Identifier"
          ? d.name
          : null;
        if (name && isPascalName(name)) hasPascalDefault = true;
      },
      "JSXElement, JSXFragment"(node) {
        if (!hasComponent && enclosedInComponent(node)) hasComponent = true;
      },
      "Program:exit"(node) {
        const expectPascal = underCores || hasComponent || hasPascalDefault;
        if (expectPascal && !fileIsPascal) {
          context.report({
            node,
            message: `This file defines a ${
              underCores ? "intent core" : "React component"
            } — name it PascalCase (\`${stem}\` → \`${stem[0].toUpperCase()}${stem.slice(1)}\`).`,
          });
        } else if (!expectPascal && fileIsPascal) {
          context.report({
            node,
            message: `This file is a module of functions/values (no React component defined) — name it camelCase (\`${stem}\` → \`${stem[0].toLowerCase()}${stem.slice(1)}\`).`,
          });
        }
      },
    };
  },
};
