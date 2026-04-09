export class ColorDiff {
  constructor() {}

  render() {
    // Signal "no syntax-highlighted render available" so callers fall back
    // to the pure-TS diff renderer.
    return null;
  }
}

export class ColorFile {}

export function getSyntaxTheme() {
  return null;
}
