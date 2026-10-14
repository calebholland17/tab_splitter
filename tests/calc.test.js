const { evalMathExpr } = require('../public/js/calc');

describe('evalMathExpr', () => {
  it('evaluates a plain number', () => {
    expect(evalMathExpr('6.5')).toBe(6.5);
  });

  it('divides two numbers', () => {
    expect(evalMathExpr('24/4')).toBe(6);
  });

  it('respects operator precedence', () => {
    expect(evalMathExpr('2+3*4')).toBe(14);
  });

  it('handles parentheses', () => {
    expect(evalMathExpr('(2+3)*4')).toBe(20);
  });

  it('handles unary minus', () => {
    expect(evalMathExpr('-5+2')).toBe(-3);
  });

  it('ignores surrounding whitespace', () => {
    expect(evalMathExpr(' 24 / 4 ')).toBe(6);
  });

  it('returns null for an empty string', () => {
    expect(evalMathExpr('')).toBeNull();
  });

  it('returns null for a trailing operator', () => {
    expect(evalMathExpr('24/')).toBeNull();
  });

  it('returns null for division by zero', () => {
    expect(evalMathExpr('24/0')).toBeNull();
  });

  it('returns null for unbalanced parentheses', () => {
    expect(evalMathExpr('(2+3')).toBeNull();
  });

  it('returns null for disallowed characters', () => {
    expect(evalMathExpr('24e4')).toBeNull();
  });
});
