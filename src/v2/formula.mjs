/** Small expression language. No eval, property access, loops, imports or application access. */
export function compileFormula(source) {
  if (typeof source !== "string" || source.length > 256)
    throw new Error("Formula is limited to 256 characters.");
  const tokens =
    source.match(
      /\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+|[a-zA-Z_]+|[()+\-*/^,]|\S/g,
    ) || [];
  let pos = 0,
    depth = 0,
    nodes = 0;
  const peek = () => tokens[pos],
    take = () => tokens[pos++],
    funcs = {
      abs: Math.abs,
      sqrt: Math.sqrt,
      min: Math.min,
      max: Math.max,
      clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
    };
  function primary() {
    if (++nodes > 128 || ++depth > 32) throw new Error("Formula too complex.");
    let f;
    const t = take();
    if (t === "(") {
      f = expr();
      if (take() !== ")") throw new Error("Missing closing parenthesis.");
    } else if (t === "-") {
      const a = primary();
      f = (x) => -a(x);
    } else if (t === "+") {
      f = primary();
    } else if (t === "x") {
      f = (x) => x;
    } else if (t && /^(?:\d|\.)/.test(t) && Number.isFinite(Number(t))) {
      const n = Number(t);
      f = () => n;
    } else if (Object.hasOwn(funcs, t)) {
      if (take() !== "(") throw new Error("Expected function arguments.");
      const a = [expr()];
      while (peek() === ",") {
        take();
        a.push(expr());
      }
      if (
        take() !== ")" ||
        a.length !== (t === "clamp" ? 3 : ["min", "max"].includes(t) ? 2 : 1)
      )
        throw new Error("Wrong function arguments.");
      f = (x) => funcs[t](...a.map((fn) => fn(x)));
    } else throw new Error("Unsupported formula token: " + t);
    depth--;
    return f;
  }
  function power() {
    let f = primary();
    if (peek() === "^") {
      take();
      const a = f,
        b = power();
      f = (x) => Math.pow(a(x), b(x));
    }
    return f;
  }
  function term() {
    let f = power();
    while (["*", "/"].includes(peek())) {
      const op = take(),
        a = f,
        b = power();
      f = (x) => (op === "*" ? a(x) * b(x) : a(x) / b(x));
    }
    return f;
  }
  function expr() {
    let f = term();
    while (["+", "-"].includes(peek())) {
      const op = take(),
        a = f,
        b = term();
      f = (x) => (op === "+" ? a(x) + b(x) : a(x) - b(x));
    }
    return f;
  }
  const fn = expr();
  if (pos !== tokens.length) throw new Error("Unexpected token " + peek());
  return (x) => {
    const v = fn(x);
    return Number.isFinite(v) ? v : NaN;
  };
}
export function formulaGrid(g, expression, unit) {
  const fn = compileFormula(expression),
    mean = Float32Array.from(g.mean, (v) => (Number.isFinite(v) ? fn(v) : NaN));
  return {
    ...g,
    mean,
    min: mean.slice(),
    max: mean.slice(),
    unit: unit || g.unit,
    expression,
    method:
      "Formula applied to grid means; min/max now describe the transformed cell value",
  };
}
