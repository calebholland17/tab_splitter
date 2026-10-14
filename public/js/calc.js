// Safe arithmetic evaluator for quick-math number fields (no eval/Function).
// Supports + - * / ( ) and decimals. Returns a number, or null if the
// expression is empty, malformed, or divides by zero.
function evalMathExpr(str) {
  const src = String(str).trim();
  if (src === '') return null;
  if (!/^[0-9+\-*/().\s]+$/.test(src)) return null;

  let pos = 0;

  function peek() { return src[pos]; }
  function skipSpace() { while (src[pos] === ' ') pos++; }

  function parseExpr() {
    let value = parseTerm();
    if (value === null) return null;
    skipSpace();
    while (peek() === '+' || peek() === '-') {
      const op = src[pos++];
      const rhs = parseTerm();
      if (rhs === null) return null;
      value = op === '+' ? value + rhs : value - rhs;
      skipSpace();
    }
    return value;
  }

  function parseTerm() {
    let value = parseFactor();
    if (value === null) return null;
    skipSpace();
    while (peek() === '*' || peek() === '/') {
      const op = src[pos++];
      const rhs = parseFactor();
      if (rhs === null) return null;
      if (op === '*') {
        value = value * rhs;
      } else {
        if (rhs === 0) return null;
        value = value / rhs;
      }
      skipSpace();
    }
    return value;
  }

  function parseFactor() {
    skipSpace();
    if (peek() === '-') {
      pos++;
      const value = parseFactor();
      return value === null ? null : -value;
    }
    if (peek() === '+') {
      pos++;
      return parseFactor();
    }
    if (peek() === '(') {
      pos++;
      const value = parseExpr();
      skipSpace();
      if (value === null || peek() !== ')') return null;
      pos++;
      return value;
    }
    return parseNumber();
  }

  function parseNumber() {
    skipSpace();
    const start = pos;
    while (/[0-9.]/.test(peek() || '')) pos++;
    if (pos === start) return null;
    const text = src.slice(start, pos);
    if (!/^\d*\.?\d*$/.test(text) || text === '.' || text === '') return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  const result = parseExpr();
  skipSpace();
  if (result === null || pos !== src.length) return null;
  return result;
}

if (typeof module !== 'undefined') module.exports = { evalMathExpr };
