/**
 * Font-independent paint descriptions for U+2500..U+257F.
 *
 * The arms are deliberately cell bounded: horizontal arms end at x=0/100%
 * and vertical arms end at y=0/100%. That makes adjacent cells meet at the
 * same edge even when the terminal font has unusual box-glyph metrics.
 */
export type BoxWeight = "light" | "heavy" | "double";

type Arm = BoxWeight | undefined;

interface BoxGlyph {
  top?: Arm;
  right?: Arm;
  bottom?: Arm;
  left?: Arm;
  dashed?: "double" | "triple" | "quad";
  diagonal?: "ascending" | "descending" | "cross";
  rounded?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

const LIGHT: BoxWeight = "light";
const HEAVY: BoxWeight = "heavy";
const DOUBLE: BoxWeight = "double";

const glyph = (top?: Arm, right?: Arm, bottom?: Arm, left?: Arm): BoxGlyph => ({
  top,
  right,
  bottom,
  left,
});

const BOX_GLYPHS: Record<number, BoxGlyph> = {
  0x2500: glyph(undefined, LIGHT, undefined, LIGHT),
  0x2501: glyph(undefined, HEAVY, undefined, HEAVY),
  0x2502: glyph(LIGHT, undefined, LIGHT, undefined),
  0x2503: glyph(HEAVY, undefined, HEAVY, undefined),
  0x2504: {
    ...glyph(undefined, LIGHT, undefined, LIGHT),
    dashed: "triple",
  },
  0x2505: {
    ...glyph(undefined, HEAVY, undefined, HEAVY),
    dashed: "triple",
  },
  0x2506: { ...glyph(LIGHT, undefined, LIGHT, undefined), dashed: "triple" },
  0x2507: { ...glyph(HEAVY, undefined, HEAVY, undefined), dashed: "triple" },
  0x2508: {
    ...glyph(undefined, LIGHT, undefined, LIGHT),
    dashed: "quad",
  },
  0x2509: {
    ...glyph(undefined, HEAVY, undefined, HEAVY),
    dashed: "quad",
  },
  0x250a: { ...glyph(LIGHT, undefined, LIGHT, undefined), dashed: "quad" },
  0x250b: { ...glyph(HEAVY, undefined, HEAVY, undefined), dashed: "quad" },

  0x250c: glyph(undefined, LIGHT, LIGHT, undefined),
  0x250d: glyph(undefined, HEAVY, LIGHT, undefined),
  0x250e: glyph(undefined, LIGHT, HEAVY, undefined),
  0x250f: glyph(undefined, HEAVY, HEAVY, undefined),
  0x2510: glyph(undefined, undefined, LIGHT, LIGHT),
  0x2511: glyph(undefined, undefined, LIGHT, HEAVY),
  0x2512: glyph(undefined, undefined, HEAVY, LIGHT),
  0x2513: glyph(undefined, undefined, HEAVY, HEAVY),
  0x2514: glyph(LIGHT, LIGHT, undefined, undefined),
  0x2515: glyph(LIGHT, HEAVY, undefined, undefined),
  0x2516: glyph(HEAVY, LIGHT, undefined, undefined),
  0x2517: glyph(HEAVY, HEAVY, undefined, undefined),
  0x2518: glyph(LIGHT, undefined, undefined, LIGHT),
  0x2519: glyph(LIGHT, undefined, undefined, HEAVY),
  0x251a: glyph(HEAVY, undefined, undefined, LIGHT),
  0x251b: glyph(HEAVY, undefined, undefined, HEAVY),

  0x251c: glyph(LIGHT, LIGHT, LIGHT, undefined),
  0x251d: glyph(LIGHT, HEAVY, LIGHT, undefined),
  0x251e: glyph(HEAVY, LIGHT, LIGHT, undefined),
  0x251f: glyph(LIGHT, LIGHT, HEAVY, undefined),
  0x2520: glyph(HEAVY, LIGHT, HEAVY, undefined),
  // Mixed-weight entries follow the direction named by Unicode. For example,
  // DOWN LIGHT AND RIGHT UP HEAVY has a light bottom arm and heavy top/right
  // arms; the words are not listed in top/right/bottom/left order.
  0x2521: glyph(HEAVY, HEAVY, LIGHT, undefined),
  0x2522: glyph(LIGHT, HEAVY, HEAVY, undefined),
  0x2523: glyph(HEAVY, HEAVY, HEAVY, undefined),
  0x2524: glyph(LIGHT, undefined, LIGHT, LIGHT),
  0x2525: glyph(LIGHT, undefined, LIGHT, HEAVY),
  0x2526: glyph(HEAVY, undefined, LIGHT, LIGHT),
  0x2527: glyph(LIGHT, undefined, HEAVY, LIGHT),
  0x2528: glyph(HEAVY, undefined, HEAVY, LIGHT),
  0x2529: glyph(HEAVY, undefined, LIGHT, HEAVY),
  0x252a: glyph(LIGHT, undefined, HEAVY, HEAVY),
  0x252b: glyph(HEAVY, undefined, HEAVY, HEAVY),

  0x252c: glyph(undefined, LIGHT, LIGHT, LIGHT),
  0x252d: glyph(undefined, LIGHT, LIGHT, HEAVY),
  0x252e: glyph(undefined, HEAVY, LIGHT, LIGHT),
  0x252f: glyph(undefined, HEAVY, LIGHT, HEAVY),
  0x2530: glyph(undefined, LIGHT, HEAVY, LIGHT),
  0x2531: glyph(undefined, LIGHT, HEAVY, HEAVY),
  0x2532: glyph(undefined, HEAVY, HEAVY, LIGHT),
  0x2533: glyph(undefined, HEAVY, HEAVY, HEAVY),
  0x2534: glyph(LIGHT, LIGHT, undefined, LIGHT),
  0x2535: glyph(LIGHT, LIGHT, undefined, HEAVY),
  0x2536: glyph(LIGHT, HEAVY, undefined, LIGHT),
  0x2537: glyph(LIGHT, HEAVY, undefined, HEAVY),
  0x2538: glyph(HEAVY, LIGHT, undefined, LIGHT),
  0x2539: glyph(HEAVY, LIGHT, undefined, HEAVY),
  0x253a: glyph(HEAVY, HEAVY, undefined, LIGHT),
  0x253b: glyph(HEAVY, HEAVY, undefined, HEAVY),

  0x253c: glyph(LIGHT, LIGHT, LIGHT, LIGHT),
  0x253d: glyph(LIGHT, LIGHT, LIGHT, HEAVY),
  0x253e: glyph(LIGHT, HEAVY, LIGHT, LIGHT),
  0x253f: glyph(LIGHT, HEAVY, LIGHT, HEAVY),
  0x2540: glyph(HEAVY, LIGHT, LIGHT, LIGHT),
  0x2541: glyph(LIGHT, LIGHT, HEAVY, LIGHT),
  0x2542: glyph(HEAVY, LIGHT, HEAVY, LIGHT),
  0x2543: glyph(HEAVY, LIGHT, LIGHT, HEAVY),
  0x2544: glyph(HEAVY, HEAVY, LIGHT, LIGHT),
  0x2545: glyph(LIGHT, LIGHT, HEAVY, HEAVY),
  0x2546: glyph(LIGHT, HEAVY, HEAVY, LIGHT),
  0x2547: glyph(HEAVY, HEAVY, LIGHT, HEAVY),
  0x2548: glyph(LIGHT, HEAVY, HEAVY, HEAVY),
  0x2549: glyph(HEAVY, LIGHT, HEAVY, HEAVY),
  0x254a: glyph(HEAVY, HEAVY, HEAVY, LIGHT),
  0x254b: glyph(HEAVY, HEAVY, HEAVY, HEAVY),

  0x254c: {
    ...glyph(undefined, LIGHT, undefined, LIGHT),
    dashed: "double",
  },
  0x254d: {
    ...glyph(undefined, HEAVY, undefined, HEAVY),
    dashed: "double",
  },
  0x254e: { ...glyph(LIGHT, undefined, LIGHT, undefined), dashed: "double" },
  0x254f: { ...glyph(HEAVY, undefined, HEAVY, undefined), dashed: "double" },
  0x2550: glyph(undefined, DOUBLE, undefined, DOUBLE),
  0x2551: glyph(DOUBLE, undefined, DOUBLE, undefined),
  0x2552: glyph(undefined, DOUBLE, LIGHT, undefined),
  0x2553: glyph(undefined, LIGHT, DOUBLE, undefined),
  0x2554: glyph(undefined, DOUBLE, DOUBLE, undefined),
  0x2555: glyph(undefined, undefined, LIGHT, DOUBLE),
  0x2556: glyph(undefined, undefined, DOUBLE, LIGHT),
  0x2557: glyph(undefined, undefined, DOUBLE, DOUBLE),
  0x2558: glyph(LIGHT, DOUBLE, undefined, undefined),
  0x2559: glyph(DOUBLE, LIGHT, undefined, undefined),
  0x255a: glyph(DOUBLE, DOUBLE, undefined, undefined),
  0x255b: glyph(LIGHT, undefined, undefined, DOUBLE),
  0x255c: glyph(DOUBLE, undefined, undefined, LIGHT),
  0x255d: glyph(DOUBLE, undefined, undefined, DOUBLE),
  0x255e: glyph(LIGHT, DOUBLE, LIGHT, undefined),
  0x255f: glyph(DOUBLE, LIGHT, DOUBLE, undefined),
  0x2560: glyph(DOUBLE, DOUBLE, DOUBLE, undefined),
  0x2561: glyph(LIGHT, undefined, LIGHT, DOUBLE),
  0x2562: glyph(DOUBLE, undefined, DOUBLE, LIGHT),
  0x2563: glyph(DOUBLE, undefined, DOUBLE, DOUBLE),
  0x2564: glyph(undefined, DOUBLE, LIGHT, DOUBLE),
  0x2565: glyph(undefined, LIGHT, DOUBLE, LIGHT),
  0x2566: glyph(undefined, DOUBLE, DOUBLE, DOUBLE),
  0x2567: glyph(LIGHT, DOUBLE, undefined, DOUBLE),
  0x2568: glyph(DOUBLE, LIGHT, undefined, LIGHT),
  0x2569: glyph(DOUBLE, DOUBLE, undefined, DOUBLE),
  0x256a: glyph(LIGHT, DOUBLE, LIGHT, DOUBLE),
  0x256b: glyph(DOUBLE, LIGHT, DOUBLE, LIGHT),
  0x256c: glyph(DOUBLE, DOUBLE, DOUBLE, DOUBLE),

  0x256d: {
    ...glyph(undefined, LIGHT, LIGHT, undefined),
    rounded: "top-left",
  },
  0x256e: {
    ...glyph(undefined, undefined, LIGHT, LIGHT),
    rounded: "top-right",
  },
  0x256f: {
    ...glyph(LIGHT, undefined, undefined, LIGHT),
    rounded: "bottom-right",
  },
  0x2570: {
    ...glyph(LIGHT, LIGHT, undefined, undefined),
    rounded: "bottom-left",
  },
  0x2571: { diagonal: "ascending" },
  0x2572: { diagonal: "descending" },
  0x2573: { diagonal: "cross" },
  0x2574: glyph(undefined, undefined, undefined, LIGHT),
  0x2575: glyph(LIGHT, undefined, undefined, undefined),
  0x2576: glyph(undefined, LIGHT, undefined, undefined),
  0x2577: glyph(undefined, undefined, LIGHT, undefined),
  0x2578: glyph(undefined, undefined, undefined, HEAVY),
  0x2579: glyph(HEAVY, undefined, undefined, undefined),
  0x257a: glyph(undefined, HEAVY, undefined, undefined),
  0x257b: glyph(undefined, undefined, HEAVY, undefined),
  0x257c: glyph(undefined, HEAVY, undefined, LIGHT),
  0x257d: glyph(LIGHT, undefined, HEAVY, undefined),
  0x257e: glyph(undefined, LIGHT, undefined, HEAVY),
  0x257f: glyph(HEAVY, undefined, LIGHT, undefined),
};

const isBoxDrawingCodePoint = (cp: number): boolean =>
  cp >= 0x2500 && cp <= 0x257f;

const weightSize = (weight: BoxWeight): string => {
  switch (weight) {
    case "heavy":
      return "var(--term-box-heavy, 2px)";
    case "double":
      return "var(--term-box-double-line, 1px)";
    default:
      return "var(--term-box-light, 1px)";
  }
};

function armLayers(
  direction: "top" | "right" | "bottom" | "left",
  weight: BoxWeight,
  color: string,
  dashed: BoxGlyph["dashed"],
): string[] {
  const size = weightSize(weight);
  const horizontal = direction === "left" || direction === "right";
  const length = "50%";
  const dashCount = dashed === "double" ? 2 : dashed === "triple" ? 3 : 4;
  const dashStop = `${100 / (dashCount * 2)}%`;
  const gradient = dashed
    ? horizontal
      ? `repeating-linear-gradient(to right,${color} 0 ${dashStop},transparent ${dashStop} ${100 / dashCount}%)`
      : `repeating-linear-gradient(${color} 0 ${dashStop},transparent ${dashStop} ${100 / dashCount}%)`
    : horizontal
      ? `linear-gradient(${color},${color})`
      : `linear-gradient(90deg,${color},${color})`;

  if (weight !== DOUBLE) {
    const position =
      direction === "left"
        ? "0 50%"
        : direction === "right"
          ? "100% 50%"
          : direction === "top"
            ? "50% 0"
            : "50% 100%";
    return [
      `${gradient} ${position}/${horizontal ? length : size} ${horizontal ? size : length} no-repeat`,
    ];
  }

  const offset = "var(--term-box-double-gap, 2px)";
  if (horizontal) {
    const position = direction === "left" ? "0" : "100%";
    return [
      `linear-gradient(${color},${color}) ${position} calc(50% - ${offset})/${length} ${size} no-repeat`,
      `linear-gradient(${color},${color}) ${position} calc(50% + ${offset})/${length} ${size} no-repeat`,
    ];
  }
  const position = direction === "top" ? "0" : "100%";
  return [
    `linear-gradient(90deg,${color},${color}) calc(50% - ${offset}) ${position}/${size} ${length} no-repeat`,
    `linear-gradient(90deg,${color},${color}) calc(50% + ${offset}) ${position}/${size} ${length} no-repeat`,
  ];
}

function diagonalLayers(
  shape: NonNullable<BoxGlyph["diagonal"]>,
  color: string,
) {
  const line = `linear-gradient(45deg,transparent 0 44%,${color} 44% 56%,transparent 56% 100%)`;
  if (shape === "cross") {
    return [
      line,
      `linear-gradient(135deg,transparent 0 44%,${color} 44% 56%,transparent 56% 100%)`,
    ];
  }
  return [
    shape === "ascending"
      ? line
      : `linear-gradient(135deg,transparent 0 44%,${color} 44% 56%,transparent 56% 100%)`,
  ];
}

/** Return a complete cell-bounded background for a box-drawing code point. */
export function getBoxBackground(
  cp: number,
  foreground: string,
  background: string,
): string {
  const description = BOX_GLYPHS[cp];
  if (!description) return background;

  const layers: string[] = [];
  if (description.diagonal) {
    layers.push(...diagonalLayers(description.diagonal, foreground));
  } else {
    for (const direction of ["top", "right", "bottom", "left"] as const) {
      const weight = description[direction];
      if (weight) {
        layers.push(
          ...armLayers(direction, weight, foreground, description.dashed),
        );
      }
    }
  }

  // Rounded corners use the same edge coordinates as ordinary corners. The
  // rounded marker is intentionally retained in the lookup model so a future
  // paint correction can change only this isolated painter.
  if (description.rounded) {
    const cornerPosition = {
      "top-left": "0 0",
      "top-right": "100% 0",
      "bottom-left": "0 100%",
      "bottom-right": "100% 100%",
    }[description.rounded];
    layers.push(
      `radial-gradient(circle at ${cornerPosition},transparent 0 39%,${foreground} 40% 49%,transparent 50%) 0 0/100% 100% no-repeat`,
    );
  }
  layers.push(background);
  return layers.join(",");
}

export function hasBoxDrawingMapping(cp: number): boolean {
  return isBoxDrawingCodePoint(cp) && Boolean(BOX_GLYPHS[cp]);
}

export { BOX_GLYPHS };
