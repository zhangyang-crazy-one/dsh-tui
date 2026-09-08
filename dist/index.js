// tui-render/src/index.ts
import { render, renderToString, Text as Text32 } from "ink";
import React, { createElement as createElement3 } from "react";

// tui-render/src/app-shell.tsx
import { Box, Text, useWindowSize } from "ink";

// tui-render/src/content.ts
import stringWidth from "string-width";
var GRAPHEME = new Intl.Segmenter(void 0, { granularity: "grapheme" });
function escapeContent(text) {
  return text.replace(
    /[\u0000-\u0008\u000B-\u001F\u007F]/g,
    (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`
  ).replace(/\u001B/g, "\\x1b");
}
var WIDE_SYMBOLS_OR_EMOJIS = /[\u26A0\u2699\u2139\u23F1\u2328\u2709\u270F\u2712\u2702\u26C8\u2764]/gu;
function displayWidth(text) {
  if (text === "") return 0;
  let cols = 0;
  let simple = true;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 32 && code <= 126) {
      cols += 1;
    } else if (code >= 19968 && code <= 40959 || code >= 13312 && code <= 19903 || code >= 12288 && code <= 12351 || code >= 65281 && code <= 65376) {
      cols += 2;
    } else {
      simple = false;
      break;
    }
  }
  if (simple) return cols;
  const base = stringWidth(text);
  if (!/[\u26A0\u2699\u2139\u23F1\u2328\u2709\u270F\u2712\u2702\u26C8\u2764]/u.test(text)) {
    return base;
  }
  let extra = 0;
  for (const match of text.matchAll(WIDE_SYMBOLS_OR_EMOJIS)) {
    const nextCode = text.charCodeAt(match.index + 1);
    if (nextCode === 65039 || nextCode === 65038) {
      continue;
    }
    extra += 1;
  }
  return base + extra;
}
function wcwidthSafeSlice(text, maxCols) {
  if (maxCols <= 0) return "";
  const budget = Math.floor(maxCols);
  if (/^[\x20-\x7e]*$/u.test(text.slice(0, budget + 1))) return text.slice(0, budget);
  let cols = 0;
  let end = 0;
  for (const { segment: segment2 } of GRAPHEME.segment(text)) {
    const width = displayWidth(segment2);
    if (cols + width > maxCols) break;
    cols += width;
    end += segment2.length;
  }
  return text.slice(0, end);
}
var NARROW_TO_WIDE_EMOJIS = {
  "\u26A0": "\u{1F6A8}",
  // ⚠️ / ⚠ -> 🚨 (warning / alert)
  "\u2139": "\u{1F4A1}",
  // ℹ️ / ℹ -> 💡 (info / tip)
  "\u2699": "\u{1F527}",
  // ⚙️ / ⚙ -> 🔧 (settings / tools)
  "\u23F1": "\u23F0",
  // ⏱️ / ⏱ -> ⏰ (timer / clock)
  "\u2709": "\u{1F4E7}",
  // ✉️ / ✉ -> 📧 (mail)
  "\u270F": "\u{1F4DD}"
  // ✏️ / ✏ -> 📝 (edit / memo)
};
function formatSymbolSpacing(text) {
  if (text === "" || /^[\x20-\x7e]*$/u.test(text)) return text;
  let res = text.replace(
    /([\u26A0\u2699\u2139\u23F1\u2709\u270F])[\uFE0E\uFE0F]?/gu,
    (_, ch) => NARROW_TO_WIDE_EMOJIS[ch] ?? ch
  );
  res = res.replace(
    /([\u2328\u2712\u2702\u26C8\u2764])(?!\uFE0F|\uFE0E)/gu,
    "$1\uFE0F"
  );
  res = res.replace(
    /([\u2460-\u24F4\u2776-\u2793\u3251-\u325F\u32B1-\u32BF])([\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60])/gu,
    "$1 $2"
  );
  res = res.replace(
    /([\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60])([\u2460-\u24F4\u2776-\u2793\u3251-\u325F\u32B1-\u32BF])/gu,
    "$1 $2"
  );
  res = res.replace(
    /([\u{1F300}-\u{1FAFF}\u2600-\u27BF][\uFE0E\uFE0F]?)([\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60])/gu,
    "$1 $2"
  );
  res = res.replace(
    /([\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60])([\u{1F300}-\u{1FAFF}\u2600-\u27BF])/gu,
    "$1 $2"
  );
  return res;
}
function displayColumnSlice(text, startCol, endCol) {
  const start = Math.max(0, startCol);
  const end = Math.max(start, endCol);
  if (/^[\x20-\x7e]*$/u.test(text)) return text.slice(Math.ceil(start), Math.floor(end));
  let column = 0;
  let out = "";
  for (const part of GRAPHEME.segment(text)) {
    const width = displayWidth(part.segment);
    const next = column + width;
    if (column >= start && next <= end) out += part.segment;
    if (column >= end) break;
    column = next;
  }
  return out;
}
function padDisplayEnd(text, width) {
  if (width <= 0) return text;
  const cols = displayWidth(text);
  if (cols >= width) return text;
  return `${text}${" ".repeat(width - cols)}`;
}
function wrapDisplayLines(text, maxCols) {
  const source = text.split("\n");
  if (maxCols <= 0) return source;
  const out = [];
  for (const line5 of source) {
    if (line5 === "" || displayWidth(line5) <= maxCols) {
      out.push(line5);
      continue;
    }
    if (/^[\x20-\x7e]*$/u.test(line5)) {
      for (let i = 0; i < line5.length; i += maxCols) {
        out.push(line5.slice(i, i + maxCols));
      }
      continue;
    }
    let curLine = "";
    let curCols = 0;
    for (const { segment: segment2 } of GRAPHEME.segment(line5)) {
      const width = displayWidth(segment2);
      if (curCols + width > maxCols && curLine !== "") {
        out.push(curLine);
        curLine = segment2;
        curCols = width;
      } else {
        curLine += segment2;
        curCols += width;
      }
    }
    if (curLine !== "") {
      out.push(curLine);
    }
  }
  return out;
}

// tui-render/src/terminal-capabilities.ts
var ESC_TIMEOUT_MS = 40;
function detectColorSupport(env) {
  if (env.NO_COLOR !== void 0) return "none";
  if (env.COLORTERM === "truecolor") return "truecolor";
  if (env.TERM?.includes("256color") === true) return "256";
  return "16";
}
function detectBrandRenderTier(env) {
  if (env.TERM === "dumb") return "plain";
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG;
  if (locale !== void 0 && !/(?:utf-?8)/iu.test(locale)) return "ascii";
  if (env.TERM === "linux" || env.TERM?.startsWith("vt") === true) return "full-block";
  return "half-block";
}
function detectNotifyCapability(env) {
  if (env.ITERM_SESSION_ID !== void 0 || env.TERM_PROGRAM === "iTerm.app") return "osc99";
  if (env.WT_SESSION !== void 0) return "osc9";
  if (env.KONSOLE_VERSION !== void 0 || env.VTE_VERSION !== void 0) return "osc99";
  return "bell";
}
function notifyBytes(transport, payload, titleSuffix) {
  if (transport === "bell") return "\x07";
  const text = sanitizeOscPayload(payload ?? "DeepSeek \u56DE\u5408\u5DF2\u7ED3\u675F", 80, titleSuffix);
  if (transport === "osc99") return `\x1B]99;i=1:d=0;${text}\x07`;
  return `\x1B]9;${text}\x07`;
}
function stripControlCharacters(text) {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 31 || code >= 127 && code <= 159) continue;
    out += char;
  }
  return out;
}
function sanitizeOscPayload(text, limit = 80, titleSuffix) {
  const sanitized = stripControlCharacters(text);
  const codePoints = Array.from(sanitized);
  if (codePoints.length <= limit) return sanitized;
  if (titleSuffix !== void 0 && titleSuffix.length > 0) {
    const suffixCodePoints = Array.from(titleSuffix);
    if (suffixCodePoints.length > 0 && codePoints.length >= suffixCodePoints.length) {
      const start = codePoints.length - suffixCodePoints.length;
      let suffixMatches = true;
      for (let i = 0; i < suffixCodePoints.length; i++) {
        if (codePoints[start + i] !== suffixCodePoints[i]) {
          suffixMatches = false;
          break;
        }
      }
      if (suffixMatches) {
        const prefix = codePoints.slice(0, start);
        if (suffixCodePoints.length >= limit) {
          return suffixCodePoints.slice(0, limit).join("");
        }
        return prefix.slice(0, limit - suffixCodePoints.length).concat(suffixCodePoints).join("");
      }
    }
  }
  return codePoints.slice(0, limit).join("");
}

// tui-render/src/theme.ts
var THEME_LEVELS = {
  truecolor: {
    bg: "#151618",
    messageBg: "#25282C",
    toolBg: "#252830",
    inputBg: "#23262B",
    codeBg: "#202328",
    fg: "#EEF0F2",
    fgSoft: "#D1D4D8",
    fgDim: "#A4A9B0",
    accent: "#4D6BFE",
    accentText: "#7589FF",
    accentDim: "#34415B",
    success: "#75B984",
    warning: "#D5AE6B",
    error: "#E27D77",
    line: "#3A3E44",
    codeKeyword: "#7EB6FF",
    codeString: "#B9A4E8",
    codeComment: "#A4A9B0",
    codeCommand: "#75B984",
    markdownStrong: "#E4C58A",
    markdownEmphasis: "#C4AEF2",
    markdownCode: "#9BC9B1",
    markdownLink: "#80C7D9"
  },
  "256": {
    bg: "233",
    messageBg: "235",
    toolBg: "236",
    inputBg: "235",
    codeBg: "235",
    fg: "255",
    fgSoft: "252",
    fgDim: "248",
    accent: "69",
    accentText: "105",
    accentDim: "60",
    success: "108",
    warning: "179",
    error: "174",
    line: "240",
    codeKeyword: "111",
    codeString: "141",
    codeComment: "248",
    codeCommand: "108",
    markdownStrong: "223",
    markdownEmphasis: "183",
    markdownCode: "151",
    markdownLink: "116"
  },
  "16": {
    bg: "black",
    messageBg: "black",
    toolBg: "black",
    inputBg: "bright-black",
    codeBg: "black",
    fg: "white",
    fgSoft: "white",
    fgDim: "white",
    accent: "bright-blue",
    accentText: "bright-blue",
    accentDim: "blue",
    success: "green",
    warning: "yellow",
    error: "red",
    line: "bright-black",
    codeKeyword: "cyan",
    codeString: "magenta",
    codeComment: "bright-black",
    codeCommand: "green",
    markdownStrong: "bright-yellow",
    markdownEmphasis: "bright-magenta",
    markdownCode: "bright-green",
    markdownLink: "bright-cyan"
  },
  none: {
    bg: "",
    messageBg: "",
    toolBg: "",
    inputBg: "",
    codeBg: "",
    fg: "",
    fgSoft: "",
    fgDim: "",
    accent: "",
    accentText: "",
    accentDim: "",
    success: "",
    warning: "",
    error: "",
    line: "",
    codeKeyword: "",
    codeString: "",
    codeComment: "",
    codeCommand: "",
    markdownStrong: "",
    markdownEmphasis: "",
    markdownCode: "",
    markdownLink: ""
  }
};
var ANSI_16 = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  "bright-black": 90,
  "bright-red": 91,
  "bright-green": 92,
  "bright-yellow": 93,
  "bright-blue": 94,
  "bright-magenta": 95,
  "bright-cyan": 96,
  "bright-white": 97
};
var BACKGROUND_PADDING_CACHE_LIMIT = 256;
var backgroundPaddingCache = /* @__PURE__ */ new Map();
var activeTier = "truecolor";
function applyTheme(tier) {
  activeTier = tier;
}
function currentTier() {
  return activeTier;
}
function installTheme(env) {
  const tier = detectColorSupport(env);
  applyTheme(tier);
  return tier;
}
function tokenSequence(token, tier = activeTier) {
  const value = THEME_LEVELS[tier][token];
  if (value === "") return "";
  const background = BACKGROUND_TOKENS.has(token);
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `\x1B[${background ? "48" : "38"};2;${r};${g};${b}m`;
  }
  if (/^\d+$/.test(value)) {
    return `\x1B[${background ? "48" : "38"};5;${value}m`;
  }
  const code = ANSI_16[value];
  if (code === void 0) {
    throw new Error(`theme: unknown 16-color value "${value}" for ${token}`);
  }
  return `\x1B[${background ? code + 10 : code}m`;
}
function bgSequence(tier = activeTier) {
  return tokenSequence("bg", tier);
}
function inkColor(token, tier = activeTier) {
  const value = THEME_LEVELS[tier][token];
  if (value === "") return void 0;
  return /^\d+$/u.test(value) ? `ansi256(${value})` : value;
}
function styled(text, token, tier = activeTier, bold = false) {
  const sequence = tokenSequence(token, tier);
  if (sequence === "") return text;
  const surface = token === "markdownCode" ? tokenSequence("codeBg", tier) : "";
  return `${surface}${bold ? "\x1B[1m" : ""}${sequence}${text}\x1B[0m`;
}
function paintRow(parts, tier = activeTier) {
  return parts.map((part) => styled(part, "bg", tier)).join("");
}
function paintBackgroundRow(parts, background, columns, tier = activeTier) {
  const content = parts.map((part) => styled(part, background, tier)).join("");
  const padding = Math.max(0, columns - displayWidth(parts.join("")));
  if (padding === 0 || tokenSequence(background, tier) === "") return content;
  const cacheKey = `${tier}:${background}:${String(padding)}`;
  const cached = backgroundPaddingCache.get(cacheKey);
  if (cached !== void 0) {
    backgroundPaddingCache.delete(cacheKey);
    backgroundPaddingCache.set(cacheKey, cached);
    return `${content}${cached}`;
  }
  const paintedPadding = styled(" ".repeat(padding), background, tier);
  backgroundPaddingCache.set(cacheKey, paintedPadding);
  if (backgroundPaddingCache.size > BACKGROUND_PADDING_CACHE_LIMIT) {
    const oldest = backgroundPaddingCache.keys().next().value;
    if (oldest !== void 0) backgroundPaddingCache.delete(oldest);
  }
  return `${content}${paintedPadding}`;
}
var BACKGROUND_TOKENS = /* @__PURE__ */ new Set([
  "bg",
  "messageBg",
  "toolBg",
  "inputBg",
  "codeBg"
]);

// tui-render/src/brand.ts
var BRAND_HALF_BLOCK = [
  "                  \u2584\u2584\u2584\u2584\u2584       \u2588\u2584            ",
  "      \u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       \u2588\u2588\u2588\u2584\u2584        \u2584\u2584",
  "    \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584     \u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588",
  "  \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 ",
  " \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580  ",
  "\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2588\u2588\u2588\u2588\u2580\u2580     ",
  "\u2588\u2588\u2588       \u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       ",
  "\u2588\u2588\u2588           \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2588  \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580       ",
  "\u2588\u2588\u2588\u2588             \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2588\u2588\u2588\u2588\u2588\u2588\u2588        ",
  "\u2580\u2588\u2588\u2588\u2584             \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588         ",
  " \u2588\u2588\u2588\u2588\u2584              \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588          ",
  "  \u2588\u2588\u2588\u2588\u2584       \u2584\u2584     \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580           ",
  "   \u2580\u2588\u2588\u2588\u2588\u2584     \u2580\u2588\u2588\u2588\u2584    \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580            ",
  "     \u2580\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2584\u2584   \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584         ",
  "       \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580         ",
  "          \u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580                   "
];
var BRAND_HALF_BLOCK_FRAMES = [
  [
    "                  \u2584\u2584\u2584\u2584\u2584       \u2588\u2584            ",
    " \xB7    \u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       \u2588\u2588\u2588\u2584\u2584        \u2584\u2584",
    "    \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584     \u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588",
    "  \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 ",
    " \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580  ",
    "\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2588\u2588\u2588\u2588\u2580\u2580     ",
    "\u2588\u2588\u2588       \u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       ",
    "\u2588\u2588\u2588           \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2588  \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580       ",
    "\u2588\u2588\u2588\u2588             \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2588\u2588\u2588\u2588\u2588\u2588\u2588        ",
    "\u2580\u2588\u2588\u2588\u2584             \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588         ",
    " \u2588\u2588\u2588\u2588\u2584              \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588          ",
    "  \u2588\u2588\u2588\u2588\u2584       \u2584\u2584     \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580           ",
    "   \u2580\u2588\u2588\u2588\u2588\u2584     \u2580\u2588\u2588\u2588\u2584    \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580            ",
    "     \u2580\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2584\u2584   \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584         ",
    "       \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580         ",
    "          \u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580                   "
  ],
  [
    "  \xB7               \u2584\u2584\u2584\u2584\u2584       \u2588\u2584            ",
    "\xB7     \u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       \u2588\u2588\u2588\u2584\u2584        \u2584\u2584",
    "    \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584     \u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588",
    "  \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 ",
    " \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580  ",
    "\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2588\u2588\u2588\u2588\u2580\u2580     ",
    "\u2588\u2588\u2588       \u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       ",
    "\u2588\u2588\u2588           \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2588  \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580       ",
    "\u2588\u2588\u2588\u2588             \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2588\u2588\u2588\u2588\u2588\u2588\u2588        ",
    "\u2580\u2588\u2588\u2588\u2584             \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588         ",
    " \u2588\u2588\u2588\u2588\u2584              \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588          ",
    "  \u2588\u2588\u2588\u2588\u2584       \u2584\u2584     \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580           ",
    "   \u2580\u2588\u2588\u2588\u2588\u2584     \u2580\u2588\u2588\u2588\u2584    \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580            ",
    "     \u2580\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2584\u2584   \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584         ",
    "       \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580         ",
    "          \u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580                   "
  ],
  [
    "    o             \u2584\u2584\u2584\u2584\u2584       \u2588\u2584            ",
    "  \xB7   \u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       \u2588\u2588\u2588\u2584\u2584        \u2584\u2584",
    "    \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584     \u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588",
    "  \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 ",
    " \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580  ",
    "\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2588\u2588\u2588\u2588\u2580\u2580     ",
    "\u2588\u2588\u2588       \u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       ",
    "\u2588\u2588\u2588           \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2588  \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580       ",
    "\u2588\u2588\u2588\u2588             \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2588\u2588\u2588\u2588\u2588\u2588\u2588        ",
    "\u2580\u2588\u2588\u2588\u2584             \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588         ",
    " \u2588\u2588\u2588\u2588\u2584              \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588          ",
    "  \u2588\u2588\u2588\u2588\u2584       \u2584\u2584     \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580           ",
    "   \u2580\u2588\u2588\u2588\u2588\u2584     \u2580\u2588\u2588\u2588\u2584    \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580            ",
    "     \u2580\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2584\u2584   \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584         ",
    "       \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580         ",
    "          \u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580                   "
  ],
  [
    "      \xB7           \u2584\u2584\u2584\u2584\u2584       \u2588\u2584            ",
    "    o \u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       \u2588\u2588\u2588\u2584\u2584        \u2584\u2584",
    "    \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584     \u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588",
    "  \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 ",
    " \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580  ",
    "\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2588\u2588\u2588\u2588\u2580\u2580     ",
    "\u2588\u2588\u2588       \u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       ",
    "\u2588\u2588\u2588           \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2588  \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580       ",
    "\u2588\u2588\u2588\u2588             \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584   \u2588\u2588\u2588\u2588\u2588\u2588\u2588        ",
    "\u2580\u2588\u2588\u2588\u2584             \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588         ",
    " \u2588\u2588\u2588\u2588\u2584              \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588          ",
    "  \u2588\u2588\u2588\u2588\u2584       \u2584\u2584     \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580           ",
    "   \u2580\u2588\u2588\u2588\u2588\u2584     \u2580\u2588\u2588\u2588\u2584    \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580            ",
    "     \u2580\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2584\u2584   \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584         ",
    "       \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580         ",
    "          \u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580\u2580                   "
  ]
];
var BRAND_FULL_BLOCK = [
  "                  \u2593\u2593\u2593\u2593\u2593       \u2588\u2593            ",
  "      \u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       \u2588\u2588\u2588\u2593\u2593        \u2593\u2593",
  "    \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593     \u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588",
  "  \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 ",
  " \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593   \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593  ",
  "\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593   \u2588\u2588\u2588\u2588\u2593\u2593     ",
  "\u2588\u2588\u2588       \u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       ",
  "\u2588\u2588\u2588           \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2588  \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593       ",
  "\u2588\u2588\u2588\u2588             \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593   \u2588\u2588\u2588\u2588\u2588\u2588\u2588        ",
  "\u2593\u2588\u2588\u2588\u2593             \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588         ",
  " \u2588\u2588\u2588\u2588\u2593              \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588          ",
  "  \u2588\u2588\u2588\u2588\u2593       \u2593\u2593     \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593           ",
  "   \u2593\u2588\u2588\u2588\u2588\u2593     \u2593\u2588\u2588\u2588\u2593    \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593            ",
  "     \u2593\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2593\u2593   \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593         ",
  "       \u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593         ",
  "          \u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593                   "
];
var BRAND_ASCII = [
  "                  #####       @#            ",
  "      ###@@@@@@@@@@@@@       @@@##        ##",
  "    #@@@@@@@@@@@@@@@@@##     @@@@@@####@@@@@",
  "  #@@@@@@@@@@@@@@@@@@@@@@#    @@@@@@@@@@@@@ ",
  " #@@@@@@@@@@@@@@@@@@@@@@@@@#   #@@@@@@@@@#  ",
  "#@@@@@@@@@@@@@@@@@@@@@@@@@@@@#   @@@@##     ",
  "@@@       ##@@@@@@@@@@@###@@@@@@@@@@@       ",
  "@@@           #@@@@@@@@#@  #@@@@@@@@#       ",
  "@@@@             @@@@@@@@#   @@@@@@@        ",
  "#@@@#             #@@@@@@@@#@@@@@@@         ",
  " @@@@#              @@@@@@@@@@@@@@          ",
  "  @@@@#       ##     #@@@@@@@@@@#           ",
  "   #@@@@#     #@@@#    #@@@@@@@#            ",
  "     #@@@@@####@@@@@##   #@@@@@@@##         ",
  "       #@@@@@@@@@@@@@@@@@@#########         ",
  "          ###@@@@@@@@@###                   "
];
var BRAND_PLAIN_WORDMARK = "DeepSeek";
var BRAND_HOME_LINE = "\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u5FD9\u7684";
var BRAND_APP_TITLE = "DeepSeek \xB7 deepseek-tui";

// tui-render/src/app-shell.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var TITLE_BAR_ELLIPSIS = "\u2026";
function fitDisplayWidth(text, maxCols) {
  if (maxCols <= 0) return "";
  const ellipsisWidth = displayWidth(TITLE_BAR_ELLIPSIS);
  const budget = maxCols - ellipsisWidth;
  if (budget <= 0) return wcwidthSafeSlice(TITLE_BAR_ELLIPSIS, maxCols);
  return `${wcwidthSafeSlice(text, budget)}${TITLE_BAR_ELLIPSIS}`;
}
function layoutTitleBar(title, badge, columns) {
  const cols = Math.max(0, columns);
  if (cols === 0) return { title: "", badge: "", gap: 0 };
  const gapMin = 1;
  const titleWidth = displayWidth(title);
  const badgeWidth = displayWidth(badge);
  if (titleWidth + badgeWidth + gapMin <= cols) {
    return { title, badge, gap: cols - titleWidth - badgeWidth };
  }
  if (titleWidth + gapMin <= cols) {
    const fittedBadge2 = fitDisplayWidth(badge, cols - gapMin - titleWidth);
    return {
      title,
      badge: fittedBadge2,
      gap: cols - titleWidth - displayWidth(fittedBadge2)
    };
  }
  if (badgeWidth + gapMin <= cols) {
    const fittedTitle2 = fitDisplayWidth(title, cols - gapMin - badgeWidth);
    return {
      title: fittedTitle2,
      badge,
      gap: cols - displayWidth(fittedTitle2) - badgeWidth
    };
  }
  const inner = Math.max(0, cols - gapMin);
  const fittedTitle = fitDisplayWidth(title, Math.min(titleWidth, inner));
  const fittedBadge = fitDisplayWidth(
    badge,
    inner - displayWidth(fittedTitle)
  );
  return {
    title: fittedTitle,
    badge: fittedBadge,
    gap: cols - displayWidth(fittedTitle) - displayWidth(fittedBadge)
  };
}
function titleRun(title) {
  if (title.startsWith(BRAND_PLAIN_WORDMARK)) {
    return [
      styled(BRAND_PLAIN_WORDMARK, "accent"),
      ...title.length > BRAND_PLAIN_WORDMARK.length ? [styled(title.slice(BRAND_PLAIN_WORDMARK.length), "fg")] : []
    ];
  }
  return [styled(title, "fg")];
}
function AppShell({ title, badge, children, status, input }) {
  const { columns, rows } = useWindowSize();
  const fitted = layoutTitleBar(
    escapeContent(title),
    escapeContent(badge),
    columns
  );
  const titleParts = titleRun(fitted.title);
  if (fitted.gap > 0) titleParts.push(styled(" ".repeat(fitted.gap), "bg"));
  if (fitted.badge !== "") titleParts.push(styled(fitted.badge, "fgDim"));
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: "100%", height: rows, children: [
    /* @__PURE__ */ jsx(Box, { flexDirection: "row", width: "100%", flexShrink: 0, children: /* @__PURE__ */ jsx(Text, { children: paintRow(titleParts) }) }),
    /* @__PURE__ */ jsx(Box, { width: "100%", flexShrink: 0, children: /* @__PURE__ */ jsx(Text, { children: paintRow([styled(escapeContent("\u2500".repeat(columns)), "line")]) }) }),
    /* @__PURE__ */ jsx(Box, { flexDirection: "column", flexGrow: 1, width: "100%", overflow: "hidden", children }),
    input !== void 0 && input !== null ? /* @__PURE__ */ jsx(Box, { flexDirection: "row", width: "100%", flexShrink: 0, children: input }) : null,
    status !== void 0 && status !== null ? /* @__PURE__ */ jsx(Box, { width: "100%", flexShrink: 0, children: /* @__PURE__ */ jsx(Text, { children: paintRow([styled(escapeContent("\u2500".repeat(columns)), "line")]) }) }) : null,
    status !== void 0 && status !== null ? /* @__PURE__ */ jsx(Box, { flexDirection: "row", width: "100%", flexShrink: 0, children: status }) : null
  ] });
}

// tui-render/src/stream-view.tsx
import { Box as Box6, Text as Text6, measureElement, useStdout, useWindowSize as useWindowSize4 } from "ink";
import { memo, useCallback, useEffect as useEffect2, useLayoutEffect, useMemo, useReducer, useRef as useRef3, useState as useState2 } from "react";

// tui-render/src/hyperlink.ts
import { execSync } from "node:child_process";
var hyperlinks = false;
function probeTmuxHyperlinks(exec = execSync) {
  try {
    const termfeatures = exec("tmux display-message -p '#{client_termfeatures}'", {
      encoding: "utf8",
      timeout: 250,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return termfeatures.split(",").map((feature) => feature.trim()).includes("hyperlinks");
  } catch {
    return false;
  }
}
function detectHyperlinks(env, tmuxForwards = probeTmuxHyperlinks) {
  const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? "";
  const terminalEmulator = env.TERMINAL_EMULATOR?.toLowerCase() ?? "";
  const term = env.TERM?.toLowerCase() ?? "";
  if (env.TMUX !== void 0 || term.startsWith("tmux")) return tmuxForwards();
  if (term.startsWith("screen")) return false;
  if (env.KITTY_WINDOW_ID !== void 0 || termProgram === "kitty") return true;
  if (termProgram === "ghostty" || term.includes("ghostty") || env.GHOSTTY_RESOURCES_DIR !== void 0) {
    return true;
  }
  if (env.WEZTERM_PANE !== void 0 || termProgram === "wezterm") return true;
  if (termProgram === "warpterminal" || env.WARP_SESSION_ID !== void 0 || env.WARP_TERMINAL_SESSION_UUID !== void 0) {
    return true;
  }
  if (env.ITERM_SESSION_ID !== void 0 || termProgram === "iterm.app") {
    return true;
  }
  if (env.WT_SESSION !== void 0) return true;
  if (termProgram === "vscode") return true;
  if (termProgram === "alacritty") return true;
  if (terminalEmulator === "jetbrains-jediterm") return false;
  return false;
}
function hyperlinksEnabled() {
  return hyperlinks;
}
function setHyperlinks(value) {
  hyperlinks = value;
}
function isOsc8Href(href) {
  if (href === "") return false;
  if (/[\u0000-\u001f\u007f]/.test(href)) return false;
  return /^(https?:|mailto:|file:)/i.test(href);
}
function wrapOsc8(text, url) {
  return `\x1B]8;;${url}\x1B\\${text}\x1B]8;;\x1B\\`;
}
function linkNeedsUrlSuffix(visible, href) {
  const comparable = href.startsWith("mailto:") ? href.slice("mailto:".length) : href;
  return visible !== href && visible !== comparable;
}

// tui-render/src/token-format.ts
function roundedPercentUnits(cacheReadTokens, denominator, decimalPlaces) {
  const unitsPerPercent = decimalPlaces === 0 ? 1 : 10;
  const scale = unitsPerPercent * 100;
  const doubledScale = scale * 2;
  const denominatorQuotient = Math.floor(denominator / doubledScale);
  const denominatorRemainder = denominator % doubledScale;
  let lower = 0;
  let upper = scale;
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2);
    const factor = candidate * 2 - 1;
    const threshold = factor * denominatorQuotient + Math.ceil(factor * denominatorRemainder / doubledScale);
    if (cacheReadTokens >= threshold) lower = candidate;
    else upper = candidate - 1;
  }
  return lower;
}
function displayPercentUnits(units, decimalPlaces) {
  if (decimalPlaces === 0) return String(units);
  const whole = Math.floor(units / 10);
  const tenths = units % 10;
  return tenths === 0 ? String(whole) : `${whole}.${tenths}`;
}
function formatCacheHitPercent(cacheReadTokens, promptTokens, decimalPlaces = 0) {
  if (promptTokens === 0) return null;
  const missedInputTokens = promptTokens - cacheReadTokens;
  if (missedInputTokens === 0) return "100";
  const roundedUnits = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces);
  const fullHitUnits = decimalPlaces === 0 ? 100 : 1e3;
  if (roundedUnits < fullHitUnits) return displayPercentUnits(roundedUnits, decimalPlaces);
  let distinguishingPlaces = 1;
  let scaledDoubleGap = missedInputTokens * 200;
  const denominatorTens = Math.floor(promptTokens / 10);
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10;
    distinguishingPlaces += 1;
  }
  const denominatorOnes = promptTokens % 10;
  let roundedLoss = 5;
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1;
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10);
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss;
      break;
    }
  }
  return `99.${"9".repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`;
}

// tui-render/src/turn-tail.ts
function formatTurnTailStats(view) {
  const parts = [];
  if (view.turnOrdinal !== void 0) parts.push(`turn ${String(view.turnOrdinal)}`);
  const usage = view.turnUsage;
  if (usage !== void 0) {
    const promptTokens = usage.totalTokens - usage.outputTokens;
    parts.push(`\u2191${String(promptTokens)}`);
    parts.push(`\u2193${String(usage.outputTokens)}`);
  } else if (view.legacyOutputTokens !== void 0) {
    parts.push(`\u2193${String(view.legacyOutputTokens)}`);
  }
  if (view.elapsedMs !== void 0) parts.push(`${String(view.elapsedMs)} ms`);
  if (usage?.cacheReadTokens !== void 0 && usage.cacheWriteTokens !== void 0) {
    const promptTokens = usage.totalTokens - usage.outputTokens;
    const cacheHit = formatCacheHitPercent(usage.cacheReadTokens, promptTokens);
    if (cacheHit !== null) parts.push(`\u7F13\u5B58\u547D\u4E2D ${cacheHit}%`);
  }
  return parts.length === 0 ? void 0 : parts.join(" \xB7 ");
}
function producedPathsForTurn(cards) {
  const paths = [];
  const seen = /* @__PURE__ */ new Set();
  for (const card of cards) {
    if (card.status === "error") continue;
    const view = card.callView;
    if (view === void 0) continue;
    if (view.card !== "diff" && !(view.card === "generic" && view.kind === "edit")) {
      continue;
    }
    for (const location of view.locations ?? []) {
      if (seen.has(location.path)) continue;
      seen.add(location.path);
      paths.push(location.path);
    }
  }
  return paths;
}

// tui-render/src/stream-view.tsx
import { pathToFileURL as pathToFileURL2 } from "node:url";
import { isAbsolute as isAbsolute2 } from "node:path";

// tui-render/src/markdown.tsx
import { Box as Box2, Text as Text2, useWindowSize as useWindowSize2 } from "ink";
import { Fragment, useRef } from "react";

// tui-render/src/markdown-parse.ts
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
var MARKDOWN_PARSE_DEFAULT_CACHE_LIMIT = 2e3;
var cache = /* @__PURE__ */ new Map();
var cacheLimit = MARKDOWN_PARSE_DEFAULT_CACHE_LIMIT;
var cacheHits = 0;
var cacheParses = 0;
var cacheEvictions = 0;
function lruGet(key) {
  const value = cache.get(key);
  if (value === void 0) return void 0;
  cache.delete(key);
  cache.set(key, value);
  return value;
}
function lruSet(key, value) {
  cache.delete(key);
  while (cache.size >= cacheLimit) {
    const oldest = cache.keys().next().value;
    if (oldest === void 0) break;
    cache.delete(oldest);
    cacheEvictions += 1;
  }
  cache.set(key, value);
}
function parseMarkdownSource(source, settled) {
  if (settled && source.length > 0) {
    const cached = lruGet(source);
    if (cached !== void 0) {
      cacheHits += 1;
      return cached;
    }
  }
  cacheParses += 1;
  const root = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  });
  trimPartialClosingFence(root, source);
  if (settled && source.length > 0) {
    lruSet(source, root);
  }
  return root;
}
function trimPartialClosingFence(root, source) {
  let node = root.children.at(-1);
  while (node !== void 0 && (node.type === "list" || node.type === "listItem" || node.type === "blockquote")) {
    node = node.children.at(-1);
  }
  if (node?.type !== "code" || node.position === void 0) {
    return;
  }
  const start = node.position.start.offset;
  const end = node.position.end.offset;
  if (start === void 0 || end === void 0) {
    return;
  }
  const raw = source.slice(start, end);
  const marker = /^(`{3,}|~{3,})/.exec(raw)?.[1];
  if (marker === void 0) return;
  const lastLine = raw.split("\n").at(-1);
  if (lastLine === "" || lastLine.length >= marker.length) return;
  if (lastLine !== marker.charAt(0).repeat(lastLine.length)) return;
  node.value = node.value.slice(0, node.value.length - lastLine.length).replace(/\n$/, "");
}

// tui-render/src/painted-line.ts
function paintLineFromRenderLine(line5, hyperlinks2 = hyperlinksEnabled()) {
  if (line5.spans.length === 0) return paintRow([]);
  const parts = [];
  for (const span of line5.spans) {
    const text = displayColumnSlice(line5.text, span.start, span.end);
    if (text === "") continue;
    const styledText = styled(text, span.token, void 0, span.bold);
    if (span.href !== void 0 && hyperlinks2 && isOsc8Href(span.href)) {
      parts.push(wrapOsc8(styledText, span.href));
    } else {
      parts.push(styledText);
    }
  }
  if (line5.background !== void 0 && line5.background !== "bg") {
    return paintBackgroundRow(
      parts,
      line5.background,
      line5.backgroundColumns ?? Math.max(line5.displayWidth, 1)
    );
  }
  return paintRow(parts);
}

// tui-render/src/markdown-projector.ts
import { fromMarkdown as fromMarkdown2 } from "mdast-util-from-markdown";
import { gfmFromMarkdown as gfmFromMarkdown2 } from "mdast-util-gfm";
import { gfm as gfm2 } from "micromark-extension-gfm";
var MARKDOWN_PROJECTOR_DEFAULT_CACHE_LIMIT = 2e3;
function plainTextMarkdownBlockRenderer() {
  return PLAIN_TEXT_RENDERER;
}
var PLAIN_TEXT_RENDERER = {
  renderBlock(node, scope, blockIndex) {
    const text = extractBlockText(node);
    if (text === "") return [emptyLine(blockIndex)];
    const wrapped = wrapDisplayLines(text, scope.width);
    const startOffset = node.position?.start.offset ?? 0;
    return wrapped.map((line5, index) => ({
      text: line5,
      displayWidth: displayWidth(line5),
      spans: [{ start: 0, end: displayWidth(line5), token: "fg", bold: false }],
      rowInBlock: index,
      sourceStart: index === 0 ? startOffset : -1,
      sourceEnd: -1,
      rawTail: false
    }));
  },
  renderRawTail(text, cols, _scope) {
    return {
      text,
      displayWidth: cols,
      spans: [{ start: 0, end: cols, token: "fg", bold: false }],
      rowInBlock: 0,
      sourceStart: -1,
      sourceEnd: -1,
      rawTail: true
    };
  }
};
function emptyLine(blockIndex) {
  return {
    text: "",
    displayWidth: 0,
    spans: [{ start: 0, end: 0, token: "fg", bold: false }],
    rowInBlock: blockIndex,
    sourceStart: 0,
    sourceEnd: 0,
    rawTail: false
  };
}
function extractBlockText(node) {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  const children = node.children;
  if (children === void 0) return "";
  return children.map((child) => childText(child)).join("");
}
function childText(node) {
  if (typeof node.value === "string") return node.value;
  if (Array.isArray(node.children)) {
    return node.children.map((child) => childText(child)).join("");
  }
  return "";
}
function rangeKey(start, end) {
  return `${start}:${end}`;
}
function computeScopeKey(scope) {
  return `${scope.width}|${scope.theme}|${scope.fold}|${scope.renderMode}`;
}
var REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]\n]+\]:\s+\S/m;
function createMarkdownCollector() {
  let committed = "";
  let tail = "";
  let rev = 0;
  return {
    append(delta) {
      if (delta === "") return;
      const combined = tail + delta;
      const lastNewline = combined.lastIndexOf("\n");
      if (lastNewline === -1) {
        tail = combined;
        return;
      }
      committed += combined.slice(0, lastNewline + 1);
      tail = combined.slice(lastNewline + 1);
      rev += 1;
    },
    committedSource() {
      return committed;
    },
    rawTail() {
      return tail;
    },
    committedLength() {
      return committed.length;
    },
    sourceLength() {
      return committed.length + tail.length;
    },
    revision() {
      return rev;
    },
    finalize() {
      if (tail === "") return committed.length;
      committed += tail + "\n";
      tail = "";
      rev += 1;
      return committed.length;
    },
    reset() {
      committed = "";
      tail = "";
      rev = 0;
    }
  };
}
function createMarkdownProjector(renderer = plainTextMarkdownBlockRenderer(), options = {}) {
  const cacheLimit2 = options.cacheLimit ?? MARKDOWN_PROJECTOR_DEFAULT_CACHE_LIMIT;
  if (!Number.isInteger(cacheLimit2) || cacheLimit2 < 1) {
    throw new Error(`cacheLimit must be a positive integer, got ${String(cacheLimit2)}`);
  }
  const collector = createMarkdownCollector();
  const detectDirective = options.detectVisualizationDirective;
  const cache2 = /* @__PURE__ */ new Map();
  let projections = 0;
  let stableHits = 0;
  let safeRecomputes = 0;
  let safeRecomputeReasons = {};
  let stableBlocksReused = 0;
  let stableRowsReused = 0;
  let stableBlocksRerendered = 0;
  let cacheEvictions2 = 0;
  let tailLinesPainted = 0;
  let topLevelBlocksRendered = 0;
  let parsedBytes = 0;
  let lastProjectionRevision = -1;
  let lastProjectionRenderMode;
  let lastScopeKey = "";
  let lastEntries = [];
  let lastCommittedLength = 0;
  function incrementReason(reason) {
    const current = safeRecomputeReasons[reason] ?? 0;
    safeRecomputeReasons[reason] = current + 1;
  }
  function detectSafeRecompute(source, renderMode) {
    if (lastProjectionRenderMode !== void 0 && lastProjectionRenderMode !== renderMode) {
      return "render-mode-change";
    }
    if (REFERENCE_DEFINITION.test(source)) return "reference-definition";
    if (detectDirective !== void 0 && detectDirective(source)) return "visualization-directive";
    const previousLast = lastEntries.at(-1)?.node;
    if (previousLast?.type === "list" || previousLast?.type === "blockquote" || previousLast?.type === "code") {
      return "parser-locality";
    }
    if (previousLast?.type === "paragraph" && /^(?:=+|-+)[ \t]*\n/u.test(source.slice(lastCommittedLength))) {
      return "parser-locality";
    }
    if (lastProjectionRevision === -1 && !canProveLocality(source)) {
      return "parser-locality";
    }
    return void 0;
  }
  function cachePut(scopeKey, value) {
    const key = `${scopeKey}|${rangeKey(value.range.start, value.range.end)}`;
    if (cache2.has(key)) {
      cache2.delete(key);
    }
    if (cache2.size >= cacheLimit2) {
      const oldestKey = cache2.keys().next().value;
      if (oldestKey !== void 0) {
        cache2.delete(oldestKey);
        cacheEvictions2 += 1;
      }
    }
    cache2.set(key, value);
  }
  function cacheLookup(scopeKey, range) {
    return cache2.get(`${scopeKey}|${rangeKey(range.start, range.end)}`);
  }
  function renderAndCache(node, scope, blockIndex, revision, scopeKey) {
    const lines = renderer.renderBlock(node, scope, blockIndex);
    const range = blockRange(node);
    const entry = { node, lines, range, revision };
    cachePut(scopeKey, entry);
    return entry;
  }
  function parseRange(source, start, settled) {
    const suffix = source.slice(start);
    parsedBytes += suffix.length;
    const root = parseSource(suffix, settled);
    if (start > 0) shiftNodeOffsets(root, start);
    return root;
  }
  function tailFor(text, scope) {
    if (text === "") return void 0;
    tailLinesPainted += 1;
    const escaped = escapeContent(text);
    return paintTail(renderer, escaped, displayWidth(escaped), scope);
  }
  function finishProjection(entries, revision, scope, scopeKey, tailText, safeRecompute, stableEntries) {
    lastEntries = entries;
    lastProjectionRevision = revision;
    lastProjectionRenderMode = scope.renderMode;
    lastScopeKey = scopeKey;
    lastCommittedLength = collector.committedLength();
    return {
      revision,
      scope,
      blocks: entries.map((entry) => entryToBlock(entry, stableEntries.has(entry))),
      tail: tailFor(tailText, scope),
      sourceLength: collector.sourceLength(),
      safeRecompute
    };
  }
  function project(scope) {
    projections += 1;
    const source = collector.committedSource();
    const tailText = collector.rawTail();
    const revision = collector.revision();
    const key = computeScopeKey(scope);
    if (revision === lastProjectionRevision && lastScopeKey === key && lastProjectionRenderMode === scope.renderMode) {
      stableHits += lastEntries.length;
      stableBlocksReused += lastEntries.length;
      stableRowsReused += lastEntries.reduce((total, entry) => total + entry.lines.length, 0);
      return finishProjection(
        lastEntries,
        revision,
        scope,
        key,
        tailText,
        void 0,
        new Set(lastEntries)
      );
    }
    const reason = detectSafeRecompute(source, scope.renderMode);
    const fullReparse = reason !== void 0 || lastProjectionRevision === -1 || lastScopeKey !== key;
    if (fullReparse) {
      if (reason !== void 0) {
        safeRecomputes += 1;
        incrementReason(reason);
      }
      if (lastScopeKey !== key && lastProjectionRevision !== -1) {
        cache2.clear();
      }
      const root2 = parseRange(source, 0, scope.renderMode === "settled");
      const entries = root2.children.map((node, blockIndex) => {
        const entry = renderAndCache(node, scope, blockIndex, revision, key);
        topLevelBlocksRendered += 1;
        return entry;
      });
      return finishProjection(
        entries,
        revision,
        scope,
        key,
        tailText,
        reason,
        /* @__PURE__ */ new Set()
      );
    }
    const previousTail = lastEntries.at(-1);
    const reparseStart = Math.max(0, previousTail?.range.start ?? 0);
    const preserved = lastEntries.slice(0, Math.max(0, lastEntries.length - 1));
    stableHits += preserved.length;
    stableBlocksReused += preserved.length;
    stableRowsReused += preserved.reduce((total, entry) => total + entry.lines.length, 0);
    const root = parseRange(source, reparseStart, scope.renderMode === "settled");
    const newEntries = [...preserved];
    const stableEntries = new Set(preserved);
    for (const [index, node] of root.children.entries()) {
      const range = blockRange(node);
      const cached = cacheLookup(key, range);
      if (cached !== void 0 && sameShape(cached.node, node)) {
        stableHits += 1;
        stableBlocksReused += 1;
        stableRowsReused += cached.lines.length;
        newEntries.push(cached);
        stableEntries.add(cached);
        continue;
      }
      const entry = renderAndCache(
        node,
        scope,
        preserved.length + index,
        revision,
        key
      );
      stableBlocksRerendered += 1;
      topLevelBlocksRendered += 1;
      newEntries.push(entry);
    }
    return finishProjection(
      newEntries,
      revision,
      scope,
      key,
      tailText,
      void 0,
      stableEntries
    );
  }
  function currentStats() {
    return Object.freeze({
      parsedBytes,
      projections,
      stableHits,
      safeRecomputes,
      safeRecomputeReasons: Object.freeze({ ...safeRecomputeReasons }),
      stableBlocksReused,
      stableRowsReused,
      stableBlocksRerendered,
      cacheEntries: cache2.size,
      cacheEvictions: cacheEvictions2,
      tailLinesPainted,
      topLevelBlocksRendered
    });
  }
  function resetAll() {
    cache2.clear();
    projections = 0;
    stableHits = 0;
    safeRecomputes = 0;
    safeRecomputeReasons = {};
    stableBlocksReused = 0;
    stableRowsReused = 0;
    stableBlocksRerendered = 0;
    cacheEvictions2 = 0;
    tailLinesPainted = 0;
    topLevelBlocksRendered = 0;
    parsedBytes = 0;
    lastProjectionRevision = -1;
    lastProjectionRenderMode = void 0;
    lastScopeKey = "";
    lastEntries = [];
    lastCommittedLength = 0;
  }
  return {
    collector,
    project,
    stats: currentStats,
    reset: resetAll
  };
}
function entryToBlock(entry, stable) {
  return {
    node: entry.node,
    lines: entry.lines,
    range: entry.range,
    stable
  };
}
function blockRange(node) {
  const position = node.position;
  if (position === void 0) return { start: -1, end: -1 };
  const start = position.start.offset ?? -1;
  const end = position.end.offset ?? -1;
  return { start, end };
}
function parseSource(source, settled) {
  if (source === "") return { type: "root", children: [] };
  return parseMarkdownSource(source, settled);
}
function shiftNodeOffsets(value, delta) {
  if (typeof value !== "object" || value === null) return;
  const node = value;
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start !== void 0 && node.position !== void 0) {
    node.position.start.offset = start + delta;
  }
  if (end !== void 0 && node.position !== void 0) {
    node.position.end.offset = end + delta;
  }
  if (node.children !== void 0) {
    for (const child of node.children) shiftNodeOffsets(child, delta);
  }
}
function paintTail(renderer, text, cols, scope) {
  return renderer.renderRawTail(text, cols, scope);
}
function canProveLocality(source) {
  if (source === "") return true;
  if (!source.endsWith("\n")) return false;
  const root = parseForLocality(source);
  const outer = lastTopLevelChild(root);
  if (outer === void 0) return true;
  const end = outer.position?.end.offset;
  if (end === void 0) return false;
  if (source[end] !== "\n") return false;
  if (outer.type === "list" || outer.type === "blockquote") {
    return end + 1 < source.length && source[end + 1] === "\n";
  }
  return true;
}
function parseForLocality(source) {
  return fromMarkdown2(source, {
    extensions: [gfm2()],
    mdastExtensions: [gfmFromMarkdown2()]
  });
}
function lastTopLevelChild(root) {
  return root.children.at(-1);
}
function sameShape(previous, current) {
  if (previous.type !== current.type) return false;
  const prev = previous.position;
  const curr = current.position;
  if (prev === void 0 || curr === void 0) return false;
  return prev.start.offset === curr.start.offset && prev.end.offset === curr.end.offset;
}

// tui-render/src/table-layout.ts
var DEFAULT_WORD_CAP = 30;
var DEFAULT_COMPACT_MIN = 1;
var DEFAULT_NARRATIVE_MIN = 4;
var DEFAULT_TOKEN_HEAVY_MIN = 8;
var DEFAULT_COLUMN_OVERHEAD = 3;
var DEFAULT_EXTRA_CHROME = 1;
var COMPACT_MAX_WIDTH = 4;
var TOKEN_HEAVY_PATTERN = /(?:https?:\/\/|\.{0,2}\/[a-z0-9_./-]+|^[a-f0-9]{8,}$)/i;
var TOKEN_HEAVY_WIDTH = 12;
function classifyColumns(cells) {
  const colCount = Math.max(0, ...cells.map((row) => row.length));
  const result = [];
  for (let c = 0; c < colCount; c += 1) {
    const column = [];
    for (const row of cells) column.push(row[c] ?? "");
    result.push(classifyColumn(column));
  }
  return result;
}
function classifyColumn(cells) {
  for (const cell of cells) {
    if (cell.length === 0) continue;
    if (TOKEN_HEAVY_PATTERN.test(cell) || !/\s/u.test(cell) && displayWidth(cell) > TOKEN_HEAVY_WIDTH) return "token-heavy";
  }
  let maxWidth = 0;
  for (const cell of cells) maxWidth = Math.max(maxWidth, displayWidth(cell));
  if (maxWidth <= COMPACT_MAX_WIDTH) return "compact";
  return "narrative";
}
function layoutTableCells(cells, options) {
  const rowCount = cells.length;
  const colCount = Math.max(
    1,
    cells.reduce((max, row) => Math.max(max, row.length), 0)
  );
  const maxCols = options.maxCols;
  const recordIndent = options.recordIndent ?? "  ";
  const dividerChar = options.dividerChar ?? "\u2500";
  const headerCells = buildCells(cells[0] ?? [], 0, colCount);
  const bodyCells = cells.slice(1).map((row, idx) => buildCells(row, idx + 1, colCount));
  if (rowCount === 0) {
    return {
      kind: "grid",
      widths: [],
      columns: [],
      header: headerCells,
      body: bodyCells,
      lines: [],
      maxCols
    };
  }
  const plan = measureTableCells(cells, options);
  if (plan.kind === "grid") {
    return buildGridLayout(
      headerCells,
      bodyCells,
      plan.columns,
      plan.widths,
      maxCols,
      dividerChar
    );
  }
  return buildRecordLayout(
    headerCells,
    bodyCells,
    plan.columns,
    maxCols,
    recordIndent,
    dividerChar
  );
}
function measureTableCells(cells, options) {
  const colCount = Math.max(
    1,
    cells.reduce((max, row) => Math.max(max, row.length), 0)
  );
  const maxCols = options.maxCols;
  const metrics = computeMetrics(
    cells,
    colCount,
    options.wordCap ?? DEFAULT_WORD_CAP,
    options.compactMin ?? DEFAULT_COMPACT_MIN,
    options.narrativeMin ?? DEFAULT_NARRATIVE_MIN,
    options.tokenHeavyMin ?? DEFAULT_TOKEN_HEAVY_MIN
  );
  const overhead = (options.columnOverhead ?? DEFAULT_COLUMN_OVERHEAD) * colCount + (options.extraChrome ?? DEFAULT_EXTRA_CHROME);
  const available = Math.max(0, maxCols - overhead);
  if (cells.length > 0 && available >= colCount) {
    const widths = fitWidths(metrics, available);
    if (widths !== null) {
      return { kind: "grid", widths, columns: metrics, maxCols };
    }
  }
  const indent = options.recordIndent ?? "  ";
  const firstMetric = metrics[0];
  const keyWidth = Math.max(4, Math.min(firstMetric.natural, Math.max(8, Math.floor(maxCols / 3))));
  const dividerWidth = Math.max(4, Math.min(maxCols - indent.length, keyWidth + 2));
  return {
    kind: "record",
    columns: metrics,
    maxCols,
    keyWidth,
    valueWidth: Math.max(4, maxCols - indent.length - dividerWidth),
    valueIndent: indent
  };
}
function appendedRowsPreserveTableMetrics(rows, metrics) {
  if (rows.some((row) => row.length > metrics.length)) return false;
  for (const row of rows) {
    const widths = metrics.map((_metric, column) => (row[column] ?? "").split("\n").map(displayWidth));
    if (!metrics[0]?.lineWidthsByRow.some((_value, index) => metrics.every((metric, column) => {
      const previous = metric.lineWidthsByRow[index];
      const next = widths[column];
      return previous.length === next.length && previous.every((width, part) => width === next[part]);
    }))) return false;
  }
  for (let column = 0; column < metrics.length; column += 1) {
    const metric = metrics[column];
    const values = rows.map((row) => row[column] ?? "");
    for (const value of values) {
      if (value.split("\n").some((line5) => !metric.wrapWidths.includes(displayWidth(line5)))) return false;
      if (longestFittingIdentifier(value, DEFAULT_WORD_CAP) > metric.minimum) return false;
    }
    const appendedCategory = classifyColumn(values);
    if (appendedCategory === "token-heavy" && metric.category !== "token-heavy") {
      return false;
    }
    if (metric.category === "narrative" && values.some((value) => longestWordIn(value, DEFAULT_WORD_CAP) > metric.minimum)) return false;
  }
  return true;
}
function buildCells(row, rowIndex, colCount) {
  const cells = [];
  for (let c = 0; c < colCount; c += 1) {
    const text = row[c] ?? "";
    cells.push({ text, width: displayWidth(text), column: c, row: rowIndex });
  }
  return cells;
}
function computeMetrics(cells, colCount, wordCap, compactMin, narrativeMin, tokenHeavyMin) {
  const categories = classifyColumns(cells);
  const result = [];
  for (let c = 0; c < colCount; c += 1) {
    const column = [];
    let natural = 1;
    let longestWord = 1;
    let identifierWidth = 1;
    const wrapWidths = /* @__PURE__ */ new Set();
    const lineWidthsByRow = [];
    for (const row of cells) {
      const cell = row[c] ?? "";
      column.push(cell);
      const lineWidths = cell.split("\n").map(displayWidth);
      lineWidthsByRow.push(lineWidths);
      for (const w of lineWidths) {
        wrapWidths.add(w);
        if (w > natural) natural = w;
      }
      longestWord = Math.max(longestWord, longestWordIn(cell, wordCap));
      identifierWidth = Math.max(identifierWidth, longestFittingIdentifier(cell, wordCap));
    }
    const category = categories[c] ?? "narrative";
    let minimum;
    if (category === "compact") {
      if (natural <= COMPACT_MAX_WIDTH) {
        minimum = natural;
      } else {
        minimum = Math.max(compactMin, longestWord);
      }
    } else if (category === "narrative") {
      minimum = Math.max(narrativeMin, longestWord);
    } else {
      minimum = Math.max(tokenHeavyMin, identifierWidth);
    }
    if (minimum > natural) minimum = natural;
    if (minimum < 1) minimum = 1;
    result.push({ category, natural, minimum, wrapWidths: [...wrapWidths].sort((a, b) => a - b), lineWidthsByRow });
  }
  return result;
}
function fitWidths(metrics, available) {
  const natural = metrics.map((metric) => metric.natural);
  if (natural.reduce((sum, width) => sum + width, 0) <= available) return natural;
  const widths = metrics.map((metric) => metric.minimum);
  let used = widths.reduce((sum, w) => sum + w, 0);
  if (used > available) return null;
  while (used < available) {
    let best = -1;
    let bestWidth = 0;
    let bestGain = -1;
    let bestPressure = -1;
    for (const [index, metric] of metrics.entries()) {
      const width = widths[index];
      if (width >= metric.natural) continue;
      let next = metric.natural;
      for (const length of metric.wrapWidths) {
        const lines = Math.ceil(length / width);
        if (lines > 1) next = Math.min(next, Math.ceil(length / (lines - 1)));
      }
      next = Math.min(next, width + available - used);
      let saved = 0;
      for (const length of metric.wrapWidths) saved += Math.ceil(length / width) - Math.ceil(length / next);
      const gain = saved / (next - width);
      const pressure = metric.natural / width;
      if (gain > bestGain || gain === bestGain && pressure > bestPressure) {
        best = index;
        bestWidth = next;
        bestGain = gain;
        bestPressure = pressure;
      }
    }
    if (best < 0) break;
    used += bestWidth - widths[best];
    widths[best] = bestWidth;
  }
  const balanced = balancedWidths(metrics, available);
  return estimatedTableRows(metrics, widths) < estimatedTableRows(metrics, balanced) ? widths : balanced;
}
function balancedWidths(metrics, available) {
  let low = 1;
  let high = Math.max(...metrics.map((metric) => metric.natural));
  const at = (ceiling) => metrics.map((metric) => Math.max(metric.minimum, Math.min(metric.natural, ceiling)));
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (at(middle).reduce((sum, width) => sum + width, 0) <= available) low = middle;
    else high = middle - 1;
  }
  const widths = at(low);
  let spare = available - widths.reduce((sum, width) => sum + width, 0);
  for (const [index, metric] of metrics.entries()) {
    if (spare === 0) break;
    if (widths[index] < metric.natural && widths[index] <= low) {
      widths[index] = widths[index] + 1;
      spare -= 1;
    }
  }
  return widths;
}
function estimatedTableRows(metrics, widths) {
  let height = 0;
  const seen = /* @__PURE__ */ new Set();
  for (let row = 0; row < (metrics[0]?.lineWidthsByRow.length ?? 0); row += 1) {
    const pattern = metrics.map((metric) => metric.lineWidthsByRow[row]);
    const key = JSON.stringify(pattern);
    if (seen.has(key)) continue;
    seen.add(key);
    height += Math.max(...pattern.map((lines, index) => lines.reduce((sum, length) => sum + Math.max(1, Math.ceil(length / widths[index])), 0)));
  }
  return height;
}
function longestFittingIdentifier(text, cap) {
  let longest = 1;
  for (const match of text.matchAll(/[A-Za-z0-9_][A-Za-z0-9_./:@+-]*/gu)) {
    if (match[0].length <= cap) longest = Math.max(longest, match[0].length);
  }
  return longest;
}
function longestWordIn(text, cap) {
  let max = 1;
  for (const word of text.split(/\s+/)) {
    if (word === "") continue;
    const width = displayWidth(word);
    if (width > max) max = Math.min(cap, width);
  }
  return max;
}
function buildGridLayout(headerCells, bodyCells, metrics, widths, maxCols, dividerChar) {
  const lines = [];
  const ruleTop = ruleText(widths, "top", dividerChar);
  const ruleMid = ruleText(widths, "mid", dividerChar);
  const ruleBottom = ruleText(widths, "bottom", dividerChar);
  lines.push({ kind: "rule", text: ruleTop });
  for (const line5 of wrapRow(headerCells, widths, true)) {
    lines.push(line5);
  }
  lines.push({ kind: "rule", text: ruleMid });
  let previousMultiline = false;
  for (const [index, row] of bodyCells.entries()) {
    const multiline = isMultilineTableRow(row.map((cell) => cell.text), widths);
    if (index > 0 && (previousMultiline || multiline)) lines.push({ kind: "rule", text: ruleMid });
    for (const line5 of wrapRow(row, widths, false)) {
      lines.push(line5);
    }
    previousMultiline = multiline;
  }
  lines.push({ kind: "rule", text: ruleBottom });
  return {
    kind: "grid",
    widths: [...widths],
    columns: metrics,
    header: [...headerCells],
    body: bodyCells,
    lines,
    maxCols
  };
}
function wrapRow(row, widths, header) {
  const wrapped = row.map((cell) => {
    const width = widths[cell.column];
    return cell.width <= width && !cell.text.includes("\n") ? [cell.text] : wrapTableCell(cell.text, width);
  });
  const height = wrapped.reduce((max, lines) => Math.max(max, lines.length), 1);
  const out = [];
  for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
    const cells = row.map((cell, col) => {
      const linesForCell = wrapped[col];
      const lineText = linesForCell[lineIndex] ?? "";
      const text = padDisplayEnd(lineText, widths[col]);
      return { text, width: displayWidth(text), column: cell.column, row: cell.row };
    });
    out.push({ kind: "row", header, cells });
  }
  return out;
}
function isMultilineTableRow(cells, widths) {
  return cells.some((cell, index) => cell.includes("\n") || displayWidth(cell) > (widths[index] ?? 0));
}
function wrapTableCell(text, width) {
  if (width <= 0) return text.split("\n");
  const out = [];
  for (const source of text.split("\n")) {
    let line5 = "";
    for (const token of source.match(/\s+|\S+/gu) ?? []) {
      if (displayWidth(line5 + token) <= width) {
        line5 += token;
        continue;
      }
      if (line5.trimEnd() !== "") out.push(line5.trimEnd());
      const pieces = wrapDisplayLines(token.trimStart(), width);
      out.push(...pieces.slice(0, -1));
      line5 = pieces.at(-1) ?? "";
    }
    out.push(line5.trimEnd());
  }
  return out;
}
function ruleText(widths, kind, dividerChar) {
  const fill = widths.map((width) => dividerChar.repeat(Math.max(1, width)));
  if (kind === "top") return `\u250C\u2500${fill.join("\u2500\u252C\u2500")}\u2500\u2510`;
  if (kind === "bottom") return `\u2514\u2500${fill.join("\u2500\u2534\u2500")}\u2500\u2518`;
  return `\u251C\u2500${fill.join("\u2500\u253C\u2500")}\u2500\u2524`;
}
function buildRecordLayout(headerCells, bodyCells, metrics, maxCols, indent, dividerChar) {
  const firstMetric = metrics[0];
  const keyWidth = Math.max(4, Math.min(firstMetric.natural, Math.max(8, Math.floor(maxCols / 3))));
  const dividerWidth = Math.max(4, Math.min(maxCols - indent.length, keyWidth + 2));
  const valueWidth = Math.max(4, maxCols - indent.length - dividerWidth);
  const lines = [];
  lines.push({
    kind: "record",
    key: headerCells[0],
    values: headerCells.slice(1)
  });
  for (let i = 0; i < bodyCells.length; i += 1) {
    if (i > 0) {
      lines.push({
        kind: "rule",
        text: indent + dividerChar.repeat(dividerWidth)
      });
    }
    const row = bodyCells[i];
    lines.push({
      kind: "record",
      key: row[0],
      values: row.slice(1)
    });
  }
  return {
    kind: "record",
    header: [...headerCells],
    lines,
    maxCols,
    keyWidth,
    valueWidth,
    valueIndent: indent
  };
}

// tui-render/src/markdown-render.ts
function makeBuffer() {
  return { segments: [], cols: 0 };
}
function appendSegment(buffer, segment2) {
  buffer.segments.push(segment2);
  buffer.cols += displayWidth(segment2.text);
}
function freezeLine(buffer, rowInBlock, sourceStart) {
  let col = 0;
  const spans = [];
  for (const seg of buffer.segments) {
    if (seg.text === "") continue;
    const segWidth = displayWidth(seg.text);
    if (seg.token === "fg" && !seg.bold && seg.href === void 0) {
      const last = spans[spans.length - 1];
      if (last && last.token === "fg" && !last.bold && last.href === void 0 && last.end === col) {
        last.end += segWidth;
      } else {
        spans.push({ start: col, end: col + segWidth, token: "fg", bold: false });
      }
    } else {
      spans.push({ start: col, end: col + segWidth, token: seg.token, bold: seg.bold, href: seg.href });
    }
    col += segWidth;
  }
  return {
    text: buffer.segments.map((s) => s.text).join(""),
    displayWidth: col,
    spans,
    rowInBlock,
    sourceStart: rowInBlock === 0 ? sourceStart : -1,
    sourceEnd: -1,
    rawTail: false
  };
}
function freezeEmpty(rowInBlock, sourceStart) {
  return {
    text: "",
    displayWidth: 0,
    spans: [{ start: 0, end: 0, token: "fg", bold: false }],
    rowInBlock,
    sourceStart: rowInBlock === 0 ? sourceStart : -1,
    sourceEnd: -1,
    rawTail: false
  };
}
function inlineToSegments(node, hyperlinks2) {
  switch (node.type) {
    case "text":
      return [{ text: escapeContent(formatSymbolSpacing(node.value)), token: "fg", bold: false }];
    case "inlineCode":
      return [{ text: escapeContent(node.value), token: "markdownCode", bold: false }];
    case "strong":
      return node.children.flatMap((child) => inlineToSegments(child, hyperlinks2)).map((segment2) => ({
        ...segment2,
        token: segment2.token === "fg" ? "markdownStrong" : segment2.token,
        bold: true
      }));
    case "emphasis":
      return node.children.flatMap((child) => inlineToSegments(child, hyperlinks2)).map((segment2) => ({
        ...segment2,
        token: segment2.token === "fg" ? "markdownEmphasis" : segment2.token
      }));
    case "delete":
      return [{
        text: escapeContent(literalText(node)),
        token: "fgDim",
        bold: false
      }];
    case "link": {
      const visible = literalText(node);
      const escaped = escapeContent(visible);
      const segments = [{
        text: escaped,
        token: "markdownLink",
        bold: false,
        href: node.url,
        hrefVisible: visible
      }];
      if (!hyperlinks2 && linkNeedsUrlSuffix(visible, node.url)) {
        segments.push({
          text: ` (${node.url})`,
          token: "fgDim",
          bold: false
        });
      }
      return segments;
    }
    case "linkReference": {
      return [{ text: escapeContent(literalText(node)), token: "fg", bold: false }];
    }
    case "image":
      return [{ text: escapeContent(node.alt ?? ""), token: "fg", bold: false }];
    case "break":
      return [{ text: "\n", token: "fg", bold: false }];
    default: {
      const children = node.children;
      if (children === void 0) return [];
      return children.flatMap((child) => inlineToSegments(child, hyperlinks2));
    }
  }
}
function literalText(node) {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  const children = node.children;
  if (children === void 0) return "";
  return children.map((child) => literalText(child)).join("");
}
function renderParagraph(node, width, rowOffset, sourceStart, hyperlinks2) {
  const segments = [];
  for (const child of node.children) {
    segments.push(...inlineToSegments(child, hyperlinks2));
  }
  return wrapInlineSegments(segments, width, rowOffset, sourceStart);
}
function wrapInlineSegments(segments, width, rowOffset, sourceStart) {
  if (segments.length === 0) {
    return [freezeEmpty(rowOffset, sourceStart)];
  }
  const lines = [];
  let buffer = makeBuffer();
  let row = rowOffset;
  const flush = () => {
    lines.push(freezeLine(buffer, row, sourceStart));
    row += 1;
    buffer = makeBuffer();
  };
  for (const seg of segments) {
    const parts = seg.text.split("\n");
    for (const [index, part] of parts.entries()) {
      if (index > 0) flush();
      let rest = part;
      while (rest !== "") {
        if (buffer.cols >= width) flush();
        let text = wcwidthSafeSlice(rest, width - buffer.cols);
        if (text === "" && buffer.cols > 0) {
          flush();
          continue;
        }
        if (text === "") text = wrapDisplayLines(rest, width)[0];
        appendSegment(buffer, { ...seg, text });
        rest = rest.slice(text.length);
      }
    }
  }
  if (buffer.segments.length > 0 || lines.length === 0) {
    lines.push(freezeLine(buffer, row, sourceStart));
  }
  return lines;
}
function renderHeading(node, width, rowOffset, sourceStart) {
  const text = node.children.map(literalText).join("");
  const depth = node.depth === 1;
  const prefix = depth ? "\u2501\u2501\u2501 " : "\u2501 ";
  const suffix = depth ? " \u2501\u2501\u2501" : "";
  const wrapped = wrapDisplayLines(`${prefix}${escapeContent(formatSymbolSpacing(text))}${suffix}`, width);
  return wrapped.map((line5, index) => {
    const buffer = makeBuffer();
    appendSegment(buffer, { text: line5, token: "accentText", bold: true });
    return freezeLine(buffer, rowOffset + index, index === 0 ? sourceStart : -1);
  });
}
function renderBlockquote(children, width, rowOffset, sourceStart, hyperlinks2) {
  const segments = [];
  for (const child of children) segments.push(...inlineToSegments(child, hyperlinks2));
  const merged = segments.map((s) => s.text).join("");
  const wrapped = wrapDisplayLines(`\u2502 ${escapeContent(merged)}`, width);
  return wrapped.map((line5, index) => {
    const buffer = makeBuffer();
    appendSegment(buffer, { text: line5, token: "fgDim", bold: false });
    return freezeLine(buffer, rowOffset + index, index === 0 ? sourceStart : -1);
  });
}
function renderList(list, width, rowOffset, sourceStart, hyperlinks2) {
  const lines = [];
  const ordered = list.ordered === true;
  list.children.forEach((item, index) => {
    const marker = ordered ? `${(list.start ?? 1) + index}. ` : "- ";
    const segments = [{ text: marker, token: "fg", bold: false }];
    const children = item.children;
    for (const child of children) segments.push(...inlineToSegments(child, hyperlinks2));
    lines.push(...wrapInlineSegments(segments, width, rowOffset + lines.length, index === 0 ? sourceStart : -1));
  });
  return lines;
}
function renderCode(value, width, rowOffset, sourceStart) {
  const lines = value.split("\n");
  const out = [];
  let row = rowOffset;
  for (const [index, line5] of lines.entries()) {
    const wrapped = wrapDisplayLines(escapeContent(line5), Math.max(1, width - 2));
    if (wrapped.length === 0) {
      out.push(freezeEmpty(row, index === 0 ? sourceStart : -1));
      row += 1;
      continue;
    }
    for (const [partIndex, part] of wrapped.entries()) {
      const buffer = makeBuffer();
      const tokens = tokenizeCodeLine(`  ${part}`);
      for (const tk of tokens) {
        appendSegment(buffer, { text: tk.text, token: tk.token, bold: tk.bold });
      }
      const line6 = freezeLine(
        buffer,
        row,
        index === 0 && partIndex === 0 ? sourceStart : -1
      );
      out.push({ ...line6, background: "codeBg" });
      row += 1;
    }
  }
  return out;
}
var CODE_KEYWORDS = /* @__PURE__ */ new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "import",
  "export",
  "from",
  "async",
  "await",
  "class",
  "interface",
  "type",
  "new",
  "throw",
  "try",
  "catch",
  "finally",
  "switch",
  "case",
  "break",
  "continue",
  "default",
  "true",
  "false",
  "null",
  "undefined",
  "this"
]);
function tokenizeCodeLine(source) {
  const out = [];
  if (source === "") return out;
  const trimmed = source.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("--")) {
    return [{ text: source, token: "codeComment", bold: false }];
  }
  let i = 0;
  let plain = source.slice(0, source.length - trimmed.length);
  const flushPlain = () => {
    if (plain !== "") {
      out.push({ text: plain, token: "fg", bold: false });
      plain = "";
    }
  };
  while (i < trimmed.length) {
    const ch = trimmed.charAt(i);
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = trimmed.indexOf(ch, i + 1);
      const stop = end === -1 ? trimmed.length : end + 1;
      flushPlain();
      out.push({ text: trimmed.slice(i, stop), token: "codeString", bold: false });
      i = stop;
      continue;
    }
    if (ch === "/" && trimmed.charAt(i + 1) === "/") {
      flushPlain();
      out.push({ text: trimmed.slice(i), token: "codeComment", bold: false });
      return out;
    }
    const wordMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed.slice(i));
    if (wordMatch !== null && CODE_KEYWORDS.has(wordMatch[0])) {
      flushPlain();
      out.push({ text: wordMatch[0], token: "codeKeyword", bold: false });
      i += wordMatch[0].length;
      continue;
    }
    plain += ch;
    i += 1;
  }
  flushPlain();
  return out;
}
function renderTable(node, width, rowOffset, sourceStart) {
  const cells = node.children.map(
    (row) => row.children.map((cell) => cell.children.map(literalText).join(""))
  );
  return renderTableCells(cells, width, rowOffset, sourceStart);
}
function renderTableCells(cells, width, rowOffset, sourceStart) {
  const safeCells = cells.map((row2) => row2.map((cell) => escapeContent(formatSymbolSpacing(cell))));
  const layout = layoutTableCells(safeCells, { maxCols: Math.max(1, width) });
  const lines = [];
  let row = rowOffset;
  const appendLine = (segments) => {
    const buffer = makeBuffer();
    for (const segment2 of segments) appendSegment(buffer, segment2);
    lines.push(freezeLine(buffer, row, row === rowOffset ? sourceStart : -1));
    row += 1;
  };
  if (layout.kind === "record") {
    renderRecordLayout(layout, Math.max(1, width), appendLine);
    return lines;
  }
  for (const line5 of layout.lines) {
    appendLine(gridLayoutSegments(line5));
  }
  return lines;
}
function renderStreamingTableCells(committedCells, tailCells, width, rowOffset, sourceStart, previous) {
  const safeWidth = Math.max(1, width);
  const plannedCells = tailCells === void 0 ? committedCells : [...committedCells, tailCells];
  const appendedCells = previous === void 0 ? plannedCells : [
    ...committedCells.slice(previous.committedRows),
    ...tailCells === void 0 ? [] : [tailCells]
  ];
  const escapedAppended = appendedCells.map((row) => row.map((cell) => escapeContent(formatSymbolSpacing(cell))));
  const plan = previous !== void 0 && previous.width === safeWidth && previous.committedRows <= committedCells.length && appendedRowsPreserveTableMetrics(escapedAppended, previous.columns) ? {
    kind: "grid",
    widths: previous.widths,
    columns: previous.columns,
    maxCols: safeWidth
  } : measureTableCells(
    plannedCells.map((row) => row.map((cell) => escapeContent(formatSymbolSpacing(cell)))),
    { maxCols: safeWidth }
  );
  if (plan.kind !== "grid") {
    return {
      lines: renderTableCells(plannedCells, safeWidth, rowOffset, sourceStart),
      cache: void 0
    };
  }
  const reusable = previous !== void 0 && previous.width === safeWidth && previous.committedRows <= committedCells.length && sameNumberArray(previous.widths, plan.widths);
  let committedLines;
  if (reusable) {
    committedLines = previous.lines.slice(0, -1);
    for (let index = previous.committedRows; index < committedCells.length; index += 1) {
      const cells = committedCells[index];
      if (cells === void 0) continue;
      appendGridBodyRow(
        committedLines,
        index > 1 ? committedCells[index - 1] : void 0,
        cells,
        plan.widths,
        rowOffset,
        sourceStart
      );
    }
    committedLines.push(ruleRenderLine(
      gridRule(plan.widths, "bottom"),
      rowOffset + committedLines.length,
      sourceStart
    ));
  } else {
    committedLines = renderGridTableWithWidths(
      committedCells,
      plan.widths,
      rowOffset,
      sourceStart
    );
  }
  const cache2 = {
    width: safeWidth,
    widths: plan.widths,
    columns: plan.columns,
    committedRows: committedCells.length,
    lines: committedLines
  };
  if (tailCells === void 0) return { lines: committedLines, cache: cache2 };
  const presentation = committedLines.slice(0, -1);
  appendGridBodyRow(
    presentation,
    committedCells.length > 1 ? committedCells.at(-1) : void 0,
    tailCells,
    plan.widths,
    rowOffset,
    sourceStart
  );
  presentation.push(ruleRenderLine(
    gridRule(plan.widths, "bottom"),
    rowOffset + presentation.length,
    sourceStart
  ));
  return { lines: presentation, cache: cache2 };
}
function sameNumberArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function gridRule(widths, kind) {
  const fill = widths.map((cellWidth) => "\u2500".repeat(Math.max(1, cellWidth)));
  if (kind === "top") return `\u250C\u2500${fill.join("\u2500\u252C\u2500")}\u2500\u2510`;
  if (kind === "mid") return `\u251C\u2500${fill.join("\u2500\u253C\u2500")}\u2500\u2524`;
  return `\u2514\u2500${fill.join("\u2500\u2534\u2500")}\u2500\u2518`;
}
function ruleRenderLine(text, rowInBlock, sourceStart) {
  const buffer = makeBuffer();
  appendSegment(buffer, { text, token: "fgDim", bold: false });
  return freezeLine(buffer, rowInBlock, rowInBlock === 0 ? sourceStart : -1);
}
function renderGridTableWithWidths(cells, widths, rowOffset, sourceStart) {
  const out = [];
  out.push(ruleRenderLine(gridRule(widths, "top"), rowOffset, sourceStart));
  out.push(...renderGridRow(cells[0] ?? [], widths, true, rowOffset + out.length, sourceStart));
  out.push(ruleRenderLine(gridRule(widths, "mid"), rowOffset + out.length, sourceStart));
  for (let index = 1; index < cells.length; index += 1) {
    appendGridBodyRow(
      out,
      index > 1 ? cells[index - 1] : void 0,
      cells[index],
      widths,
      rowOffset,
      sourceStart
    );
  }
  out.push(ruleRenderLine(gridRule(widths, "bottom"), rowOffset + out.length, sourceStart));
  return out;
}
function appendGridBodyRow(out, previous, cells, widths, rowOffset, sourceStart) {
  if (previous !== void 0 && (isMultilineTableRow(previous.map((cell) => escapeContent(formatSymbolSpacing(cell))), widths) || isMultilineTableRow(cells.map((cell) => escapeContent(formatSymbolSpacing(cell))), widths))) {
    out.push(ruleRenderLine(gridRule(widths, "mid"), rowOffset + out.length, sourceStart));
  }
  out.push(...renderGridRow(cells, widths, false, rowOffset + out.length, sourceStart));
}
function renderGridRow(row, widths, header, rowOffset, sourceStart) {
  const wrapped = widths.map((columnWidth, column) => {
    const text = escapeContent(formatSymbolSpacing(row[column] ?? ""));
    return displayWidth(text) <= columnWidth && !text.includes("\n") ? [text] : wrapTableCell(text, columnWidth);
  });
  const height = wrapped.reduce((maximum, lines) => Math.max(maximum, lines.length), 1);
  const out = [];
  for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
    const buffer = makeBuffer();
    appendSegment(buffer, { text: "\u2502 ", token: "fgDim", bold: false });
    for (let column = 0; column < widths.length; column += 1) {
      if (column > 0) appendSegment(buffer, { text: " \u2502 ", token: "fgDim", bold: false });
      const text = wrapped[column]?.[lineIndex] ?? "";
      appendSegment(buffer, {
        text: padDisplayEnd(text, widths[column]),
        token: header ? "accentText" : "fg",
        bold: header
      });
    }
    appendSegment(buffer, { text: " \u2502", token: "fgDim", bold: false });
    out.push(freezeLine(buffer, rowOffset + lineIndex, rowOffset === 0 && lineIndex === 0 ? sourceStart : -1));
  }
  return out;
}
function gridLayoutSegments(line5) {
  if (line5.kind === "rule" || line5.kind === "plain") {
    return [{ text: line5.text, token: line5.kind === "rule" ? "fgDim" : "fg", bold: false }];
  }
  if (line5.kind === "record") return [];
  const segments = [{ text: "\u2502 ", token: "fgDim", bold: false }];
  for (const [index, cell] of line5.cells.entries()) {
    if (index > 0) segments.push({ text: " \u2502 ", token: "fgDim", bold: false });
    segments.push({
      text: cell.text,
      token: line5.header ? "accentText" : "fg",
      bold: line5.header
    });
  }
  segments.push({ text: " \u2502", token: "fgDim", bold: false });
  return segments;
}
function renderRecordLayout(layout, width, appendLine) {
  const records = layout.lines.filter((line5) => line5.kind === "record");
  if (records.length <= 1) {
    const header = layout.header.map((cell) => cell.text).join(" | ");
    for (const line5 of wrapDisplayLines(header, width)) {
      appendLine([{ text: line5, token: "accentText", bold: true }]);
    }
    return;
  }
  for (const line5 of layout.lines) {
    if (line5.kind === "rule") {
      appendLine([{ text: line5.text, token: "fgDim", bold: false }]);
      continue;
    }
    if (line5.kind !== "record" || line5.key.row === 0) continue;
    const keyLabel = layout.header[0]?.text ?? "key";
    const keyText = keyLabel === "" ? line5.key.text : `${keyLabel}: ${line5.key.text}`;
    for (const text of wrapTableCell(keyText, width)) {
      appendLine([{ text, token: "accentText", bold: true }]);
    }
    for (const value of line5.values) {
      const label = layout.header[value.column]?.text ?? `#${String(value.column + 1)}`;
      const indent = wcwidthSafeSlice(layout.valueIndent, Math.max(0, width - 1));
      for (const text of wrapTableCell(`${label}: ${value.text}`, width - displayWidth(indent))) {
        appendLine([{ text: indent + text, token: "fg", bold: false }]);
      }
    }
  }
}
function createStyledMarkdownBlockRenderer(options) {
  const { width, hyperlinks: hyperlinks2 } = options;
  return {
    renderBlock(node, _scope) {
      const position = node.position;
      const sourceStart = position?.start.offset ?? 0;
      switch (node.type) {
        case "paragraph":
          return renderParagraph(node, width, 0, sourceStart, hyperlinks2);
        case "heading":
          return renderHeading(node, width, 0, sourceStart);
        case "blockquote":
          return renderBlockquote(
            node.children,
            width,
            0,
            sourceStart,
            hyperlinks2
          );
        case "list":
          return renderList(node, width, 0, sourceStart, hyperlinks2);
        case "code":
          return renderCode(node.value, width, 0, sourceStart);
        case "table":
          return renderTable(node, width, 0, sourceStart);
        default:
          return [freezeEmpty(0, sourceStart)];
      }
    },
    renderRawTail(text, cols, _scope) {
      const buffer = makeBuffer();
      appendSegment(buffer, { text, token: "fg", bold: false });
      return {
        text: buffer.segments.map((s) => s.text).join(""),
        displayWidth: cols,
        spans: [{ start: 0, end: cols, token: "fg", bold: false }],
        rowInBlock: 0,
        sourceStart: -1,
        sourceEnd: -1,
        rawTail: true
      };
    }
  };
}

// tui-render/src/table-scanner.ts
var FENCE_MIN = 3;
var DELIMITER_CELL_PATTERN = /^[\s:]*-{1,}[\s:]*$/;
var TableScanner = class {
  buffer = "";
  /** Absolute source offset of the buffer's first character. */
  bufferBaseOffset = 0;
  /** Total bytes fed across the scanner's lifetime (including the current buffer). */
  totalFed = 0;
  /** Active fence marker (` or `~`) or null when outside any fence. */
  fenceMarker = null;
  /** Length of the opening fence; close fences must match or exceed it. */
  fenceLength = 0;
  stateKind = "none";
  headerRow = null;
  delimiterRow = null;
  bodyRows = [];
  pendingClosed = null;
  /** Reset every internal state. Pending `closedTable` is also cleared. */
  reset() {
    this.buffer = "";
    this.bufferBaseOffset = 0;
    this.totalFed = 0;
    this.fenceMarker = null;
    this.fenceLength = 0;
    this.stateKind = "none";
    this.headerRow = null;
    this.delimiterRow = null;
    this.bodyRows = [];
    this.pendingClosed = null;
  }
  /**
   * Append a source chunk and return the latest snapshot. Empty chunks still
   * surface any pending `closedTable` so the consumer cannot miss a close.
   * @param chunk - new source bytes (may end mid-line).
   * @returns the latest {@link TableScannerSnapshot}.
   */
  feed(chunk) {
    if (chunk === "") return this.snapshot();
    this.buffer += chunk;
    this.totalFed += chunk.length;
    this.processLines(false);
    return this.snapshot();
  }
  /**
   * Close the source. Any unterminated trailing line is flushed as a
   * completed line, then any open table is atomically finalized.
   * @returns the final snapshot.
   */
  finalize() {
    if (this.buffer.length > 0) this.processLines(true);
    this.closeTable();
    return this.snapshot();
  }
  /**
   * Get the current snapshot without consuming any new input. Useful when the
   * consumer wants to re-poll a `closedTable` between `feed` calls.
   * @returns the latest {@link TableScannerSnapshot}.
   */
  snapshot() {
    const closed = this.pendingClosed;
    this.pendingClosed = null;
    let rows = [];
    let mutableStart = 0;
    let mutableEnd = 0;
    if (this.stateKind === "pending-header" && this.headerRow) {
      rows = [this.headerRow];
      mutableStart = this.headerRow.start;
      mutableEnd = this.headerRow.end;
    } else if (this.stateKind === "confirmed-table" && this.headerRow && this.delimiterRow) {
      rows = [this.headerRow, this.delimiterRow, ...this.bodyRows];
      mutableStart = this.headerRow.start;
      const last = this.bodyRows.length > 0 ? this.bodyRows[this.bodyRows.length - 1] : null;
      mutableEnd = last ? last.end : this.delimiterRow.end;
    }
    return {
      state: this.buildState(),
      rows,
      mutableStart,
      mutableEnd,
      closedTable: closed
    };
  }
  /** Walk the buffer, classify each completed line, then trim the consumed prefix. */
  processLines(forceFlush) {
    let lineStart = 0;
    const buf = this.buffer;
    let i = 0;
    while (i < buf.length) {
      if (buf.charCodeAt(i) === 10) {
        let end = i;
        if (end > lineStart && buf.charCodeAt(end - 1) === 13) end -= 1;
        const line5 = buf.slice(lineStart, end);
        const startOff = this.bufferBaseOffset + lineStart;
        const endOff = this.bufferBaseOffset + end;
        this.handleLine(line5, startOff, endOff);
        lineStart = i + 1;
      }
      i += 1;
    }
    if (forceFlush && lineStart < buf.length) {
      const line5 = buf.slice(lineStart);
      const startOff = this.bufferBaseOffset + lineStart;
      const endOff = this.bufferBaseOffset + buf.length;
      this.handleLine(line5, startOff, endOff);
      lineStart = buf.length;
    }
    if (lineStart > 0) {
      this.buffer = buf.slice(lineStart);
      this.bufferBaseOffset += lineStart;
    }
  }
  /** Dispatch one completed line through the state machine. */
  handleLine(line5, start, end) {
    const fence = detectFence(line5);
    if (fence !== null) {
      if (this.fenceMarker === null) {
        this.fenceMarker = fence.marker;
        this.fenceLength = fence.length;
      } else if (fence.marker === this.fenceMarker && fence.length >= this.fenceLength) {
        this.fenceMarker = null;
        this.fenceLength = 0;
      }
      this.closeTable();
      return;
    }
    if (this.fenceMarker !== null) return;
    const cells = parsePipeRow(line5);
    if (cells === null) {
      this.closeTable();
      return;
    }
    if (this.stateKind === "none") {
      this.stateKind = "pending-header";
      this.headerRow = { text: line5, cells, start, end, isDelimiter: false };
      return;
    }
    if (this.stateKind === "pending-header" && this.headerRow) {
      if (isDelimiterRow(cells) && cells.length === this.headerRow.cells.length) {
        const delimiter = {
          text: line5,
          cells,
          start,
          end,
          isDelimiter: true
        };
        this.stateKind = "confirmed-table";
        this.delimiterRow = delimiter;
        this.bodyRows = [];
        return;
      }
      this.headerRow = { text: line5, cells, start, end, isDelimiter: false };
      return;
    }
    if (this.stateKind === "confirmed-table" && this.delimiterRow) {
      if (cells.length === this.delimiterRow.cells.length) {
        this.bodyRows.push({ text: line5, cells, start, end, isDelimiter: false });
        return;
      }
      this.closeTable();
      return;
    }
  }
  /** Finalize the current table. `pending-header` collapses to `none` silently. */
  closeTable() {
    if (this.stateKind === "pending-header") {
      this.stateKind = "none";
      this.headerRow = null;
      return;
    }
    if (this.stateKind === "confirmed-table" && this.headerRow && this.delimiterRow) {
      const last = this.bodyRows.length > 0 ? this.bodyRows[this.bodyRows.length - 1] : null;
      const end = last ? last.end : this.delimiterRow.end;
      this.pendingClosed = {
        header: this.headerRow,
        delimiter: this.delimiterRow,
        body: this.bodyRows,
        rows: [this.headerRow, this.delimiterRow, ...this.bodyRows],
        headerStart: this.headerRow.start,
        end
      };
    }
    this.stateKind = "none";
    this.headerRow = null;
    this.delimiterRow = null;
    this.bodyRows = [];
  }
  buildState() {
    if (this.stateKind === "pending-header" && this.headerRow) {
      return { kind: "pending-header", header: this.headerRow };
    }
    if (this.stateKind === "confirmed-table" && this.headerRow && this.delimiterRow) {
      return {
        kind: "confirmed-table",
        header: this.headerRow,
        delimiter: this.delimiterRow,
        body: this.bodyRows
      };
    }
    return { kind: "none" };
  }
};
function detectFence(line5) {
  let i = 0;
  while (i < line5.length && (line5.charCodeAt(i) === 32 || line5.charCodeAt(i) === 9)) i += 1;
  if (i >= 4) return null;
  if (i >= line5.length) return null;
  const ch = line5.charCodeAt(i);
  if (ch !== 96 && ch !== 126) return null;
  const runStart = i;
  while (i < line5.length && line5.charCodeAt(i) === ch) i += 1;
  const length = i - runStart;
  if (length < FENCE_MIN) return null;
  if (ch === 96) {
    for (let j = i; j < line5.length; j += 1) {
      if (line5.charCodeAt(j) === 96) return null;
    }
  }
  return { marker: String.fromCharCode(ch), length };
}
function parsePipeRow(line5) {
  const trimmed = line5.trim();
  if (trimmed === "") return null;
  let pipeCount = 0;
  for (let i2 = 0; i2 < trimmed.length; i2 += 1) {
    const ch = trimmed.charCodeAt(i2);
    if (ch === 92 && i2 + 1 < trimmed.length && trimmed.charCodeAt(i2 + 1) === 124) {
      i2 += 1;
      continue;
    }
    if (ch === 124) pipeCount += 1;
  }
  if (pipeCount === 0) return null;
  let startIdx = 0;
  let endIdx = trimmed.length;
  if (trimmed.charCodeAt(0) === 124) startIdx = 1;
  if (endIdx > 1 && trimmed.charCodeAt(endIdx - 1) === 124) endIdx -= 1;
  const cells = [];
  let current = "";
  let i = startIdx;
  while (i < endIdx) {
    const ch = trimmed.charCodeAt(i);
    if (ch === 92 && i + 1 < endIdx && trimmed.charCodeAt(i + 1) === 124) {
      current += "|";
      i += 2;
      continue;
    }
    if (ch === 124) {
      cells.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += trimmed.charAt(i);
    i += 1;
  }
  cells.push(current.trim());
  return cells;
}
function parsePipeTableCells(line5) {
  return parsePipeRow(line5) ?? void 0;
}
function isDelimiterRow(cells) {
  if (cells.length === 0) return false;
  for (const cell of cells) {
    if (!DELIMITER_CELL_PATTERN.test(cell)) return false;
  }
  return true;
}

// tui-render/src/markdown.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var KEYWORDS = /* @__PURE__ */ new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "import",
  "export",
  "from",
  "async",
  "await",
  "class",
  "interface",
  "type",
  "new",
  "throw",
  "try",
  "catch",
  "finally",
  "switch",
  "case",
  "break",
  "continue",
  "default",
  "true",
  "false",
  "null",
  "undefined",
  "this"
]);
var MARKDOWN_CACHE_LIMIT = 2e3;
var tokenCache = /* @__PURE__ */ new Map();
var tokenHits = 0;
var tokenMisses = 0;
var tokenEvictions = 0;
function lruGet2(cache2, key) {
  const value = cache2.get(key);
  if (value === void 0) return void 0;
  cache2.delete(key);
  cache2.set(key, value);
  return value;
}
function lruSet2(cache2, key, value, evicted) {
  cache2.delete(key);
  while (cache2.size >= MARKDOWN_CACHE_LIMIT) {
    const oldest = cache2.keys().next().value;
    if (oldest === void 0) break;
    cache2.delete(oldest);
    evicted();
  }
  cache2.set(key, value);
}
function tokenizeLine(source) {
  const tokens = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") {
      tokens.push({ kind: "plain", text: plain });
      plain = "";
    }
  };
  const trimmed = source.trimStart();
  const indent = source.slice(0, source.length - trimmed.length);
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("--")) {
    return [{ kind: "comment", text: source }];
  }
  let i = 0;
  while (i < trimmed.length) {
    const char = trimmed.charAt(i);
    if (char === "'" || char === '"' || char === "`") {
      const end = trimmed.indexOf(char, i + 1);
      const stop = end === -1 ? trimmed.length : end + 1;
      flush();
      tokens.push({ kind: "string", text: indent + trimmed.slice(i, stop) });
      i = stop;
      continue;
    }
    if (char === "/" && trimmed.charAt(i + 1) === "/") {
      flush();
      tokens.push({ kind: "comment", text: indent + trimmed.slice(i) });
      return tokens;
    }
    const word = trimmed.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0];
    if (word !== void 0 && KEYWORDS.has(word)) {
      flush();
      tokens.push({ kind: "keyword", text: word });
      i += word.length;
      continue;
    }
    plain += char;
    i += 1;
  }
  flush();
  return tokens;
}
function tokenize(source, lang) {
  const key = `${lang}:${source}`;
  const cached = lruGet2(tokenCache, key);
  if (cached !== void 0) {
    tokenHits += 1;
    return cached;
  }
  tokenMisses += 1;
  const tokens = source.split("\n").flatMap((line5) => tokenizeLine(line5));
  lruSet2(tokenCache, key, tokens, () => {
    tokenEvictions += 1;
  });
  return tokens;
}
var TOKEN_STYLES = {
  keyword: "codeKeyword",
  string: "codeString",
  comment: "codeComment",
  plain: void 0
};
var TOKEN_BOLD = /* @__PURE__ */ new Set(["keyword"]);
function tokenSequence2(token, bold = false) {
  const wrapped = styled("", token);
  if (wrapped === "") return "";
  const sequence = wrapped.slice(0, -4);
  return bold ? `\x1B[1m${sequence}` : sequence;
}
function HighlightedLine({
  source,
  lang,
  prefix = "",
  tail
}) {
  const tokens = tokenize(source, lang);
  const spans = tokens.map((token) => {
    const style = TOKEN_STYLES[token.kind] ?? "fg";
    const bold = TOKEN_BOLD.has(token.kind);
    const prefixSequence = tokenSequence2(style, bold);
    const boldClose = bold && prefixSequence !== "" ? "\x1B[22m" : "";
    return `${prefixSequence}${escapeContent(token.text)}${boldClose}`;
  }).join("");
  return /* @__PURE__ */ jsxs2(Text2, { children: [
    prefix,
    styled(`  ${spans}`, "codeBg"),
    tail
  ] });
}
function CodeBlock({
  source,
  lang,
  lead = "",
  rest = "",
  tail
}) {
  const lines = source.split("\n");
  return /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", children: lines.map((line5, index) => /* @__PURE__ */ jsx2(
    HighlightedLine,
    {
      source: line5,
      lang,
      prefix: index === 0 ? lead : rest,
      tail: index === lines.length - 1 ? tail : void 0
    },
    index
  )) });
}
function paintedLineFromRenderLine(line5, hyperlinks2) {
  return paintLineFromRenderLine(line5, hyperlinks2 && hyperlinksEnabled());
}
function linesToJsx(lines, affixes, hyperlinks2) {
  if (lines.length === 0) return null;
  return /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", width: "100%", children: lines.map((line5, index) => {
    const painted = paintedLineFromRenderLine(line5, hyperlinks2);
    const prefix = index === 0 ? affixes.lead : affixes.rest;
    const tail = index === lines.length - 1 ? affixes.tail : void 0;
    return /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate", children: [
      prefix,
      painted,
      tail
    ] }, index);
  }) });
}
function buildRenderer(width, hyperlinks2) {
  return createStyledMarkdownBlockRenderer({ width, hyperlinks: hyperlinks2 });
}
function computeScopeKey2(width, theme, fold, renderMode) {
  return `${width}|${theme}|${fold}|${renderMode}`;
}
function MarkdownBlock({
  source,
  maxCols,
  prefix,
  tail,
  settled = false
}) {
  const { columns } = useWindowSize2();
  const stateRef = useRef(null);
  const width = Math.max(1, maxCols ?? columns);
  const prefixWidth = Math.max(
    displayWidth(prefix?.first ?? ""),
    displayWidth(prefix?.rest ?? "")
  );
  const tailWidth = displayWidth(tail ?? "");
  const bodyWidth = Math.max(1, width - prefixWidth - tailWidth);
  if (!source.endsWith("\n") && (tail === void 0 || settled)) {
    return renderFullSource(source, bodyWidth, prefix, tail, settled);
  }
  if (stateRef.current === null) {
    const scope = {
      width: bodyWidth,
      theme: "truecolor",
      fold: "expanded",
      renderMode: settled ? "settled" : "streaming"
    };
    stateRef.current = {
      projector: createMarkdownProjector(buildRenderer(
        bodyWidth,
        /* hyperlinks */
        false
      ), { cacheLimit: MARKDOWN_CACHE_LIMIT }),
      scanner: new TableScanner(),
      lastSource: "",
      scopeKey: computeScopeKey2(bodyWidth, scope.theme, scope.fold, scope.renderMode),
      renderer: buildRenderer(bodyWidth, false),
      cache: /* @__PURE__ */ new Map(),
      lastBlocks: []
    };
  }
  const state = stateRef.current;
  const scopeKey = computeScopeKey2(bodyWidth, "truecolor", "expanded", settled ? "settled" : "streaming");
  if (state.scopeKey !== scopeKey) {
    state.projector = createMarkdownProjector(buildRenderer(bodyWidth, false), { cacheLimit: MARKDOWN_CACHE_LIMIT });
    state.renderer = buildRenderer(bodyWidth, false);
    state.cache.clear();
    state.lastBlocks = [];
    state.scanner.reset();
    state.scopeKey = scopeKey;
  }
  if (source !== state.lastSource) {
    if (!source.startsWith(state.lastSource)) {
      state.projector.collector.reset();
      state.projector.reset();
      state.scanner.reset();
      state.cache.clear();
      state.lastBlocks = [];
    }
    const delta = source.slice(state.lastSource.length);
    state.projector.collector.append(delta);
    state.scanner.feed(delta);
    state.lastSource = source;
  }
  if (settled || tail === void 0) {
    state.projector.collector.finalize();
    state.scanner.finalize();
  }
  const projection = state.projector.project({
    width: bodyWidth,
    theme: "truecolor",
    fold: "expanded",
    renderMode: settled ? "settled" : "streaming"
  });
  const scannerSnap = state.scanner.snapshot();
  const activeTableTailCells = scannerSnap.state.kind === "confirmed-table" && projection.tail !== void 0 ? parsePipeTableCells(projection.tail.text) : void 0;
  const renderScope = {
    width: bodyWidth,
    theme: "truecolor",
    fold: "expanded",
    renderMode: settled ? "settled" : "streaming"
  };
  const affixes = {
    lead: prefix?.first ?? "",
    rest: prefix?.rest ?? "",
    tail
  };
  const out = [];
  const blocks = projection.blocks;
  let blockIndex = 0;
  for (const block of blocks) {
    const range = block.range;
    const overlaps = scannerSnap.state.kind === "confirmed-table" && range.end > scannerSnap.mutableStart && range.start < scannerSnap.mutableEnd;
    if (overlaps) {
      blockIndex += 1;
      continue;
    }
    const isLast = blockIndex === blocks.length - 1 && projection.tail === void 0 && scannerSnap.state.kind !== "confirmed-table";
    const blockAffixes = {
      lead: blockIndex === 0 ? affixes.lead : affixes.rest,
      rest: affixes.rest,
      tail: isLast ? affixes.tail : void 0
    };
    if (out.length > 0 && block.lines.length > 0) {
      out.push(
        /* @__PURE__ */ jsx2(Box2, { children: /* @__PURE__ */ jsx2(Text2, { wrap: "truncate", children: " " }) }, `b-gap-${blockIndex}`)
      );
    }
    out.push(/* @__PURE__ */ jsx2(Fragment, { children: renderBlockEntry(block, blockAffixes, state, renderScope) }, `b-${blockIndex}`));
    blockIndex += 1;
  }
  if (scannerSnap.state.kind === "confirmed-table" && scannerSnap.rows.length > 0) {
    const tableAffixes = {
      lead: blocks.length === 0 ? affixes.lead : affixes.rest,
      rest: affixes.rest,
      tail: projection.tail === void 0 ? affixes.tail : void 0
    };
    const tableRows = [
      ...scannerSnap.rows.filter((row) => !row.isDelimiter),
      ...activeTableTailCells === void 0 ? [] : [{ cells: activeTableTailCells }]
    ];
    out.push(/* @__PURE__ */ jsx2(Fragment, { children: renderActiveTable(tableRows, bodyWidth, tableAffixes, false) }, "active-table"));
  }
  if (projection.tail !== void 0 && activeTableTailCells === void 0) {
    out.push(
      /* @__PURE__ */ jsx2(Fragment, { children: renderFullSource(
        projection.tail.text,
        bodyWidth,
        {
          first: blocks.length === 0 && scannerSnap.rows.length === 0 ? affixes.lead : affixes.rest,
          rest: affixes.rest
        },
        affixes.tail,
        false
      ) }, "tail")
    );
  }
  return wrapMarkdownOutput(out, tail, prefix);
}
function renderBlockEntry(block, affixes, state, _scope) {
  const rangeKey2 = `${block.range.start}:${block.range.end}`;
  const cached = state.cache.get(rangeKey2);
  if (cached !== void 0) {
    return cached.node;
  }
  const node = linesToJsx(
    block.lines,
    affixes,
    /* hyperlinks */
    false
  );
  const lastRow = block.lines.at(-1);
  const entry = {
    node,
    lastRowWidth: lastRow?.displayWidth ?? 0,
    range: block.range
  };
  state.cache.set(rangeKey2, entry);
  return node;
}
function renderActiveTable(rows, width, affixes, hyperlinks2) {
  return linesToJsx(renderTableCells(rows.map((row) => row.cells), width, 0, -1), affixes, hyperlinks2);
}
function renderFullSource(source, bodyWidth, prefix, tail, settled) {
  const root = parseMarkdownSource(source, settled);
  const hyperlinks2 = hyperlinksEnabled();
  const renderer = buildRenderer(bodyWidth, hyperlinks2);
  const affixes = {
    lead: prefix?.first ?? "",
    rest: prefix?.rest ?? "",
    tail
  };
  const out = [];
  const scanner = new TableScanner();
  scanner.feed(source);
  scanner.finalize();
  const snap = scanner.snapshot();
  let blockIndex = 0;
  const blocks = root.children;
  for (const block of blocks) {
    const range = blockPositionRange(block);
    const overlaps = snap.state.kind === "confirmed-table" && range.end > snap.mutableStart && range.start < snap.mutableEnd;
    if (overlaps) {
      blockIndex += 1;
      continue;
    }
    const isLast = blockIndex === blocks.length - 1;
    const blockAffixes = {
      lead: blockIndex === 0 ? affixes.lead : affixes.rest,
      rest: affixes.rest,
      tail: isLast ? affixes.tail : void 0
    };
    const lines = renderer.renderBlock(block, {
      width: bodyWidth,
      theme: "truecolor",
      fold: "expanded",
      renderMode: "streaming"
    }, blockIndex);
    if (out.length > 0 && lines.length > 0) {
      out.push(
        /* @__PURE__ */ jsx2(Box2, { children: /* @__PURE__ */ jsx2(Text2, { wrap: "truncate", children: " " }) }, `full-b-gap-${blockIndex}`)
      );
    }
    out.push(
      /* @__PURE__ */ jsx2(Fragment, { children: linesToJsx(lines, blockAffixes, hyperlinks2) }, `full-b-${blockIndex}`)
    );
    blockIndex += 1;
  }
  if (snap.state.kind === "confirmed-table" && snap.rows.length > 0) {
    const tableAffixes = {
      lead: blocks.length === 0 ? affixes.lead : affixes.rest,
      rest: affixes.rest,
      tail: blocks.length === 0 ? affixes.tail : void 0
    };
    out.push(/* @__PURE__ */ jsx2(Fragment, { children: renderActiveTable(snap.rows, bodyWidth, tableAffixes, hyperlinks2) }, "full-active-table"));
  }
  return wrapMarkdownOutput(out, tail, prefix);
}
function wrapMarkdownOutput(out, tail, prefix) {
  if (out.length === 0 && tail === void 0) {
    return /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", width: "100%" });
  }
  if (out.length === 0) {
    return /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", width: "100%", children: /* @__PURE__ */ jsxs2(Text2, { children: [
      prefix?.first,
      tail
    ] }) });
  }
  return /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", width: "100%", children: out });
}
function blockPositionRange(node) {
  const position = node.position;
  if (position === void 0) return { start: -1, end: -1 };
  return { start: position.start.offset ?? -1, end: position.end.offset ?? -1 };
}

// tui-render/src/reasoning.tsx
import { Box as Box3, Text as Text3, useWindowSize as useWindowSize3 } from "ink";

// tui-render/src/ui-copy.ts
var zh = {
  on: "\u5F00",
  off: "\u5173",
  reasoning: "\u601D\u8003",
  scrollbar: "\u8F68\u9053",
  statusDetails: "\u6307\u6807\u8BE6\u60C5",
  locale: "\u754C\u9762\u8BED\u8A00",
  metrics: "\u6307\u6807",
  mode: "\u6A21\u5F0F",
  tools: "\u5DE5\u5177",
  context: "\u4E0A\u4E0B\u6587",
  status: "\u72B6\u6001",
  effort: "\u5F3A\u5EA6",
  cacheHit: "\u7F13\u5B58\u547D\u4E2D",
  retry: "\u91CD\u8BD5",
  commandStatus: "\u663E\u793A/\u9690\u85CF\u5B8C\u6574\u72B6\u6001\u6307\u6807",
  commandReasoning: "\u663E\u793A/\u9690\u85CF\u5168\u6587\u601D\u8003 \xB7 Ctrl+O",
  commandScrollbar: "\u663E\u793A/\u9690\u85CF\u6EDA\u52A8\u8F68\u9053",
  settingsSaveFailed: "\u2717 \u663E\u793A\u8BBE\u7F6E\u672A\u4FDD\u5B58 \xB7 \u8BF7\u91CD\u8BD5",
  inputHint: "\u8F93\u5165\u6D88\u606F",
  sendHint: "Enter \u53D1\u9001",
  arguments: "\u53C2\u6570",
  result: "\u7ED3\u679C",
  diagnostics: "\u8BCA\u65AD\u5143\u6570\u636E",
  processStatus: "\u8FDB\u7A0B\u72B6\u6001",
  running: "\u8FD0\u884C\u4E2D",
  failed: "\u5931\u8D25",
  remaining: "\u5269\u4F59\u6E90\u884C",
  toolDetails: "/tools \u8BE6\u60C5",
  commandTools: "\u9010\u9879\u67E5\u770B\u5DE5\u5177\u53C2\u6570\u3001\u5B8C\u6574\u7ED3\u679C\u4E0E\u8BCA\u65AD",
  noTools: "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u5DE5\u5177\u8C03\u7528",
  toolListHint: "\u2191\u2193 \u9009\u62E9 \xB7 Enter \u8BE6\u60C5 \xB7 Esc \u5173\u95ED",
  toolPageHint: "\u2190\u2192 \u7FFB\u9875 \xB7 d \u8BCA\u65AD \xB7 y \u590D\u5236 \xB7 e \u5BFC\u51FA \xB7 Esc \u8FD4\u56DE",
  toolCopied: "\u2713 \u5DF2\u590D\u5236\u5B8C\u6574\u5DE5\u5177\u539F\u6587",
  toolExported: "\u2713 \u5DE5\u5177\u539F\u6587\u5DF2\u5BFC\u51FA",
  toolCopyFailed: "\u2717 \u5DE5\u5177\u539F\u6587\u590D\u5236\u5931\u8D25",
  toolExportFailed: "\u2717 \u5DE5\u5177\u539F\u6587\u5BFC\u51FA\u5931\u8D25",
  toolExportAction: "\u5BFC\u51FA\u5B8C\u6574\u539F\u6587",
  processing: "\u6B63\u5728\u5904\u7406\u2026",
  thinking: "\u601D\u8003\u4E2D\u2026"
};
var en = {
  on: "on",
  off: "off",
  reasoning: "Thinking",
  scrollbar: "Rail",
  statusDetails: "Status details",
  locale: "UI language",
  metrics: "Metrics",
  mode: "Mode",
  tools: "Tools",
  context: "Context",
  status: "Status",
  effort: "Effort",
  cacheHit: "Cache hit",
  retry: "Retry",
  commandStatus: "Show/hide full status metrics",
  commandReasoning: "Show/hide full thinking text \xB7 Ctrl+O",
  commandScrollbar: "Show/hide the scroll rail",
  settingsSaveFailed: "\u2717 Display setting was not saved \xB7 Retry",
  inputHint: "Type a message",
  sendHint: "Enter to send",
  arguments: "Arguments",
  result: "Result",
  diagnostics: "Diagnostic metadata",
  processStatus: "Process status",
  running: "Running",
  failed: "Failed",
  remaining: "source lines remaining",
  toolDetails: "/tools details",
  commandTools: "Inspect individual tool arguments, full results, and diagnostics",
  noTools: "No tool calls in this session",
  toolListHint: "\u2191\u2193 Select \xB7 Enter Details \xB7 Esc Close",
  toolPageHint: "\u2190\u2192 Pages \xB7 d Diagnostics \xB7 y Copy \xB7 e Export \xB7 Esc Back",
  toolCopied: "\u2713 Full tool source copied",
  toolExported: "\u2713 Tool source exported",
  toolCopyFailed: "\u2717 Tool source copy failed",
  toolExportFailed: "\u2717 Tool source export failed",
  toolExportAction: "Export full source",
  processing: "Processing\u2026",
  thinking: "Thinking\u2026"
};
var dictionaries = { "zh-CN": zh, "en-US": en };
function tuiCopy(key, locale = "zh-CN") {
  return dictionaries[locale][key];
}
var BRAILLE_SPINNER_FRAMES = [
  "\u280B",
  "\u2819",
  "\u2839",
  "\u2838",
  "\u283C",
  "\u2834",
  "\u2826",
  "\u2827",
  "\u2807",
  "\u280F"
];
function getBrailleSpinnerFrame(liveMs) {
  const index = Math.floor(Math.max(0, liveMs ?? 0) / 100) % BRAILLE_SPINNER_FRAMES.length;
  return BRAILLE_SPINNER_FRAMES[index] ?? BRAILLE_SPINNER_FRAMES[0];
}
var SWIMMING_FISH_FRAMES = BRAILLE_SPINNER_FRAMES;
function getSwimmingFishFrame(liveMs) {
  return getBrailleSpinnerFrame(liveMs);
}
var GENERATION_TIPS_ZH = [
  "\u63D0\u793A\uFF1ACtrl+E \u5C55\u5F00\u5DE5\u5177\u5361 \xB7 /tools \u67E5\u770B\u5B8C\u6574\u8F93\u51FA",
  "\u63D0\u793A\uFF1ACtrl+O \u5C55\u5F00/\u6536\u8D77\u601D\u8003\u8FC7\u7A0B \xB7 \u968F\u65F6\u8DDF\u8FDB\u63A8\u7406",
  "\u63D0\u793A\uFF1AShift+Tab \u5207\u6362\u591A\u884C\u8F93\u5165 \xB7 \u2191/\u2193 \u6D4F\u89C8\u5386\u53F2\u6D88\u606F",
  "\u63D0\u793A\uFF1A\u8F93\u5165 / \u6253\u5F00\u5FEB\u6377\u547D\u4EE4 \xB7 \u8F93\u5165 @ \u63D0\u53CA\u6587\u4EF6\u4E0E\u4E0A\u4E0B\u6587",
  "\u63D0\u793A\uFF1ACtrl+C \u4E2D\u65AD\u5F53\u524D\u751F\u6210 \xB7 \u968F\u65F6\u5B89\u5168\u505C\u6B62"
];
var GENERATION_TIPS_EN = [
  "Tip: Ctrl+E to expand tool cards \xB7 /tools for full output",
  "Tip: Ctrl+O to toggle thinking process \xB7 follow reasoning",
  "Tip: Shift+Tab for multiline input \xB7 \u2191/\u2193 browse history",
  "Tip: Type / for slash commands \xB7 type @ to mention context",
  "Tip: Ctrl+C to stop generation safely at any time"
];
function getBilingualTip(liveMs, locale = "zh-CN") {
  const tips = locale === "en-US" ? GENERATION_TIPS_EN : GENERATION_TIPS_ZH;
  const index = Math.floor(Math.max(0, liveMs ?? 0) / 4e3) % tips.length;
  return tips[index] ?? tips[0];
}

// tui-render/src/reasoning.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function formatSeconds(ms) {
  return (ms / 1e3).toFixed(1);
}
function thinkingHeader(durationMs, expanded, live = false, width) {
  const mark = expanded ? "\u25BE " : "";
  const icon = live ? getBrailleSpinnerFrame(durationMs) : "\u273B";
  const parts = [
    ...mark !== "" ? [styled(mark, "accentText")] : [],
    styled(`${icon} \u601D\u8003`, "accentText"),
    styled(` (${formatSeconds(durationMs)}s)`, "fgDim")
  ];
  return paintBackgroundRow(parts, "toolBg", width !== void 0 && width > 0 ? width : 0);
}
function bodyRow(line5, key, width) {
  return /* @__PURE__ */ jsx3(Text3, { wrap: "truncate", children: paintBackgroundRow([styled("\u2502 ", "accentText"), styled(escapeContent(line5), "fgDim")], "toolBg", width !== void 0 && width > 0 ? width : 0) }, key);
}
function ReasoningBlock({
  text,
  collapsed,
  durationMs,
  live = false,
  maxCols
}) {
  const { columns } = useWindowSize3();
  if (collapsed || text === "") return null;
  const width = maxCols ?? columns;
  const escaped = escapeContent(text);
  const body = wrapDisplayLines(escaped, Math.max(1, width - 4));
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", width: "100%", backgroundColor: inkColor("toolBg"), children: [
    /* @__PURE__ */ jsx3(Text3, { wrap: "truncate", children: thinkingHeader(durationMs, !live, live, width) }),
    body.map((line5, index) => bodyRow(line5, index, width))
  ] });
}

// tui-render/src/tool-card.tsx
import { Box as Box4, Text as Text4 } from "ink";

// tui-render/src/row-source.ts
function clampSliceOffset(index, length) {
  const truncated = Math.trunc(index);
  return Math.min(length, Math.max(0, index < 0 ? length + truncated : truncated));
}
function resolveItemIndex(index, length) {
  const integer = Math.trunc(index);
  const absolute = integer < 0 ? length + integer : integer;
  return absolute < 0 || absolute >= length ? void 0 : absolute;
}
function indexedRows(length, read) {
  return Object.freeze({
    length,
    at(index) {
      const absolute = resolveItemIndex(index, length);
      return absolute === void 0 ? void 0 : read(absolute);
    },
    slice(start = 0, end = length) {
      const out = [];
      const last = clampSliceOffset(end, length);
      for (let index = clampSliceOffset(start, length); index < last; index += 1) out.push(read(index));
      return out;
    }
  });
}
var RowSequence = class {
  segments = [];
  size = 0;
  /** Number of rows appended so far, without materializing them. */
  get length() {
    return this.size;
  }
  /**
   * Append a source using its known height.
   * @param rows - immutable source or ordinary readonly array.
   */
  append(rows) {
    if (rows.length === 0) return;
    this.segments.push({ start: this.size, end: this.size + rows.length, rows });
    this.size += rows.length;
  }
  /**
   * Append one already materialized spacer or heading.
   * @param row - the row to append.
   */
  push(row) {
    this.append([row]);
  }
  /**
   * Publish an immutable segment directory independent of later builder edits.
   * @returns random-access rows; only at/slice invoke the underlying sources.
   */
  build() {
    const segments = this.segments.slice();
    const length = this.size;
    const locate = (index) => {
      let low = 0;
      let high = segments.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (segments[middle].end <= index) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    return Object.freeze({
      length,
      at(index) {
        const absolute = resolveItemIndex(index, length);
        if (absolute === void 0) return void 0;
        const segment2 = segments[locate(absolute)];
        return segment2.rows.at(absolute - segment2.start);
      },
      slice(start = 0, end = length) {
        const first = clampSliceOffset(start, length);
        const last = clampSliceOffset(end, length);
        const out = [];
        for (let index = locate(first); index < segments.length; index += 1) {
          const segment2 = segments[index];
          if (segment2.start >= last) break;
          for (const row of segment2.rows.slice(Math.max(0, first - segment2.start), Math.min(segment2.rows.length, last - segment2.start))) {
            out.push(row);
          }
        }
        return out;
      }
    });
  }
};

// tui-render/src/tool-cards.ts
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
function toolCardDisplayStatus(card) {
  const terminal = card.resultView?.card === "terminal" ? card.resultView : void 0;
  if (terminal?.signal !== void 0) return "error";
  if (terminal?.exitCode !== void 0 && terminal.exitCode !== 0) return "error";
  return card.status;
}
function collapsedResultTail(text) {
  if (text === void 0) return void 0;
  const line5 = text.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean).at(-1);
  return line5 === void 0 ? void 0 : escapeContent(line5);
}
function collapsedFailureSummary(card) {
  const terminal = card.resultView?.card === "terminal" ? card.resultView : void 0;
  const identity = terminal?.exitCode !== void 0 ? `exitCode ${String(terminal.exitCode)}` : terminal?.signal !== void 0 ? `signal ${terminal.signal}` : card.error?.code;
  const detail = collapsedResultTail(terminal?.output ?? card.resultText);
  if (identity === void 0) return detail;
  return detail === void 0 || detail === identity ? identity : `${identity} \xB7 ${detail}`;
}
function collapsedToolCardSummary(card) {
  if (toolCardDisplayStatus(card) === "error") {
    const failure = collapsedFailureSummary(card);
    if (failure !== void 0) return failure;
  }
  const result = card.resultView;
  const kind = result?.card ?? card.callView?.card ?? "generic";
  switch (kind) {
    case "terminal":
      if (result?.card === "terminal" && result.exitCode !== void 0) {
        return `exitCode ${String(result.exitCode)}`;
      }
      if (result?.card === "terminal" && result.signal !== void 0) {
        return `signal ${result.signal}`;
      }
      if (result?.card === "terminal" && result.output !== void 0 && result.output !== "") {
        return escapeContent(result.output.replace(/\n/g, " "));
      }
      return card.callView?.card === "terminal" && card.callView.cwd !== void 0 ? escapeContent(card.callView.cwd) : void 0;
    case "diff": {
      const paths = card.callView?.card === "diff" ? card.callView.locations ?? card.callView.diffs.map((diff) => ({ path: diff.path })) : result.diffs.map((diff) => ({ path: diff.path }));
      return paths.length === 0 ? void 0 : escapeContent(paths.map((entry) => entry.path).join(" \xB7 "));
    }
    case "search":
      return result?.card === "search" ? `${String(result.total)} matches` : void 0;
    case "read":
      return result?.card === "read" ? escapeContent(result.path) : void 0;
    case "web":
      if (result?.card !== "web") return void 0;
      if (result.kind === "fetch") {
        return escapeContent(`${result.url} \xB7 ${String(result.statusCode)}`);
      }
      if (result.sources.length === 0) return void 0;
      return escapeContent(result.sources.length === 1 ? result.sources[0]?.title ?? result.sources[0]?.url : `${String(result.sources.length)} sources`);
    default:
      return card.callView === void 0 ? collapsedCardSummary(card.arguments) : void 0;
  }
}
function cardsFrom(content) {
  const pending = /* @__PURE__ */ new Map();
  const ordered = [];
  for (const item of content) {
    if (item.kind === "tool-call") {
      const card2 = {
        callId: item.callId,
        name: item.name,
        arguments: item.arguments,
        status: "running"
      };
      pending.set(item.callId, card2);
      ordered.push(card2);
      continue;
    }
    if (item.kind !== "tool-result") continue;
    const card = pending.get(item.callId);
    if (card === void 0) continue;
    card.status = item.isError ? "error" : "ok";
    card.resultText = item.text;
    if (item.meta !== void 0) card.meta = item.meta;
    if (item.error !== void 0) card.error = item.error;
  }
  return ordered;
}
function cardsFromActiveTurn(toolCalls, content = []) {
  const calls = toolCalls.map((call) => ({
    kind: "tool-call",
    callId: call.callId,
    name: call.name,
    arguments: call.arguments
  }));
  const results = content.filter(
    (item) => item.kind === "tool-result"
  );
  return cardsFrom([...calls, ...results]);
}
function cardsFromTurn(turn) {
  return cardsFromActiveTurn(turn.toolCalls, turn.content ?? []);
}
function attachPresenterViews(tools, card) {
  if (tools === void 0) return card;
  let args;
  try {
    args = JSON.parse(card.arguments);
  } catch {
    return card;
  }
  const def = tools.get(card.name);
  if (def === void 0) return card;
  let callView;
  try {
    const view = def.presentCall?.(args);
    if (view !== void 0 && typeof view.title === "string" && view.title !== "") {
      callView = view;
    }
  } catch {
  }
  let resultView;
  if (card.status !== "running") {
    try {
      const view = def.presentResult?.(args, {
        content: [{ type: "text", text: card.resultText ?? "" }],
        isError: card.status === "error",
        ...card.meta === void 0 ? {} : { meta: card.meta }
      });
      if (view !== void 0) {
        resultView = view;
      }
    } catch {
    }
  }
  if (callView === void 0 && resultView === void 0) return card;
  return {
    ...card,
    ...callView === void 0 ? {} : { callView },
    ...resultView === void 0 ? {} : { resultView }
  };
}
function parseSubagentArguments(argumentsJson) {
  if (argumentsJson === "" || argumentsJson === "{}") return void 0;
  try {
    const parsed = JSON.parse(argumentsJson);
    if (parsed !== null && typeof parsed === "object") {
      const obj = parsed;
      const description = typeof obj.description === "string" && obj.description !== "" ? obj.description : void 0;
      const prompt = typeof obj.prompt === "string" && obj.prompt !== "" ? obj.prompt : void 0;
      const model = typeof obj.model === "string" && obj.model !== "" ? obj.model : void 0;
      const runInBackground = typeof obj.run_in_background === "boolean" ? obj.run_in_background : void 0;
      if (description !== void 0 || prompt !== void 0 || model !== void 0) {
        return { description, prompt, model, runInBackground };
      }
    }
  } catch {
  }
  return void 0;
}
function collapsedCardSummary(argumentsJson) {
  if (argumentsJson === "") return void 0;
  let command;
  try {
    const parsed = JSON.parse(argumentsJson);
    if (parsed !== null && typeof parsed === "object") {
      const obj = parsed;
      if (typeof obj.command === "string" && obj.command !== "") {
        command = obj.command;
      } else if (typeof obj.description === "string" && obj.description !== "") {
        command = obj.description;
      } else if (typeof obj.prompt === "string" && obj.prompt !== "") {
        command = obj.prompt;
      } else if (typeof obj.query === "string" && obj.query !== "") {
        command = obj.query;
      } else if (typeof obj.task === "string" && obj.task !== "") {
        command = obj.task;
      }
    }
  } catch {
  }
  return escapeContent(command ?? argumentsJson).replace(/\n/g, " ");
}
function truncateDisplay(text, maxCols) {
  if (maxCols <= 0) return "";
  if (displayWidth(text) <= maxCols) return text;
  if (maxCols === 1) return "\u2026";
  return `${wcwidthSafeSlice(text, maxCols - 1)}\u2026`;
}
var FILE_PATH_KEYS = ["path", "file_path", "file", "target_file", "target"];
function fileUrlFromToolArguments(argumentsJson) {
  try {
    const parsed = JSON.parse(argumentsJson);
    if (parsed === null || typeof parsed !== "object") return void 0;
    const record = parsed;
    for (const key of FILE_PATH_KEYS) {
      const value = record[key];
      if (typeof value !== "string" || !isAbsolute(value)) continue;
      if (/[\u0000-\u001f\u007f]/.test(value)) continue;
      return pathToFileURL(value).href;
    }
  } catch {
  }
  return void 0;
}
function tokenizeCommandHeading(heading) {
  const trimmed = heading.trimStart();
  const leading = heading.slice(0, heading.length - trimmed.length);
  const firstSpace = trimmed.indexOf(" ");
  const cmd = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace);
  const tokens = [];
  if (leading !== "") tokens.push({ text: leading, token: "fgSoft" });
  if (cmd !== "") tokens.push({ text: cmd, token: "codeCommand" });
  if (rest !== "") tokens.push({ text: rest, token: "fgSoft" });
  return Object.freeze(tokens);
}

// tui-render/src/tool-body.ts
var graphemes = new Intl.Segmenter(void 0, { granularity: "grapheme" });
function textLines(text, prefix = "") {
  let length = 1;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) length += 1;
  let lastLine = 0;
  let lastStart = 0;
  return indexedRows(length, (index) => {
    if (index < lastLine) {
      lastLine = 0;
      lastStart = 0;
    }
    while (lastLine < index) {
      lastStart = text.indexOf("\n", lastStart) + 1;
      lastLine += 1;
    }
    const end = text.indexOf("\n", lastStart);
    return { text: prefix + text.slice(lastStart, end < 0 ? text.length : end), token: "codeBg" };
  });
}
function splitDiffLines(text) {
  if (text.length === 0) return [];
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  return normalized.split(/\r?\n/u);
}
function diffLines(oldLines, newLines) {
  if (oldLines.length === 0) return newLines.map((line5) => `+${line5}`);
  if (newLines.length === 0) return oldLines.map((line5) => `-${line5}`);
  const m = oldLines.length;
  const n = newLines.length;
  if (m * n > 5e5) {
    return [...oldLines.map((l) => `-${l}`), ...newLines.map((l) => `+${l}`)];
  }
  let prefixCount = 0;
  while (prefixCount < m && prefixCount < n && oldLines[prefixCount] === newLines[prefixCount]) {
    prefixCount++;
  }
  let suffixCount = 0;
  while (suffixCount < m - prefixCount && suffixCount < n - prefixCount && oldLines[m - 1 - suffixCount] === newLines[n - 1 - suffixCount]) {
    suffixCount++;
  }
  const trimmedOld = oldLines.slice(prefixCount, m - suffixCount);
  const trimmedNew = newLines.slice(prefixCount, n - suffixCount);
  const midM = trimmedOld.length;
  const midN = trimmedNew.length;
  const middle = [];
  if (midM === 0) {
    for (const line5 of trimmedNew) middle.push(`+${line5}`);
  } else if (midN === 0) {
    for (const line5 of trimmedOld) middle.push(`-${line5}`);
  } else {
    const stride = midN + 1;
    const dp = new Int32Array((midM + 1) * stride);
    for (let i2 = 0; i2 < midM; i2++) {
      for (let j2 = 0; j2 < midN; j2++) {
        const dest = (i2 + 1) * stride + (j2 + 1);
        if (trimmedOld[i2] === trimmedNew[j2]) {
          dp[dest] = (dp[i2 * stride + j2] ?? 0) + 1;
        } else {
          const up = dp[i2 * stride + (j2 + 1)] ?? 0;
          const left = dp[(i2 + 1) * stride + j2] ?? 0;
          dp[dest] = up > left ? up : left;
        }
      }
    }
    const rev = [];
    let i = midM;
    let j = midN;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && trimmedOld[i - 1] === trimmedNew[j - 1]) {
        rev.push(` ${trimmedOld[i - 1]}`);
        i--;
        j--;
      } else if (j > 0 && (i === 0 || (dp[i * stride + (j - 1)] ?? 0) >= (dp[(i - 1) * stride + j] ?? 0))) {
        rev.push(`+${trimmedNew[j - 1]}`);
        j--;
      } else if (i > 0) {
        rev.push(`-${trimmedOld[i - 1]}`);
        i--;
      }
    }
    for (let k = rev.length - 1; k >= 0; k--) {
      const item = rev[k];
      if (item !== void 0) middle.push(item);
    }
  }
  const result = [];
  for (let k = 0; k < prefixCount; k++) {
    result.push(` ${oldLines[k]}`);
  }
  for (const line5 of middle) {
    result.push(line5);
  }
  for (let k = m - suffixCount; k < m; k++) {
    result.push(` ${oldLines[k]}`);
  }
  return result;
}
function createToolBodyDocument(card, options) {
  const rows = new RowSequence();
  const section = (label, source) => {
    rows.push({ text: label, token: "fgDim" });
    rows.append(source);
  };
  const result = card.resultView;
  const kind = result?.card ?? card.callView?.card ?? "generic";
  const args = () => {
    section(tuiCopy("arguments", options.locale), textLines(card.arguments));
  };
  if (options.includeArguments && kind !== "generic") args();
  const bodyStart = rows.length;
  switch (kind) {
    case "terminal":
      if (result?.card === "terminal") {
        if (result.output !== void 0 && result.output !== "") section(tuiCopy("result", options.locale), textLines(result.output));
        if (result.exitCode !== void 0) section(tuiCopy("processStatus", options.locale), textLines(`exitCode ${result.exitCode}`));
        else if (result.signal !== void 0) section(tuiCopy("processStatus", options.locale), textLines(`signal ${result.signal}`));
      }
      break;
    case "diff": {
      const diffs = result?.card === "diff" ? result.diffs : card.callView?.card === "diff" ? card.callView.diffs : [];
      if (diffs.length === 0) break;
      const source = new RowSequence();
      let lastPath;
      for (const diff of diffs) {
        if (diff.path !== lastPath) {
          source.push({ text: `--- ${diff.path}`, token: "codeBg", diffKind: "header" });
          lastPath = diff.path;
        }
        const oldStart = diff.oldStart ?? (diff.oldText === null ? 0 : 1);
        const newStart = diff.newStart ?? 1;
        let lines;
        let oldLinesCount = diff.oldLines;
        let newLinesCount = diff.newLines;
        if (diff.lines !== void 0 && diff.lines.length > 0) {
          lines = diff.lines;
          oldLinesCount ??= diff.oldText === null ? 0 : splitDiffLines(diff.oldText).length;
          newLinesCount ??= splitDiffLines(diff.newText).length;
        } else if (diff.oldText === null) {
          const split = splitDiffLines(diff.newText);
          lines = split.map((line5) => `+${line5}`);
          oldLinesCount = 0;
          newLinesCount = split.length;
        } else {
          const oldSplit = splitDiffLines(diff.oldText);
          const newSplit = splitDiffLines(diff.newText);
          lines = diffLines(oldSplit, newSplit);
          oldLinesCount ??= oldSplit.length;
          newLinesCount ??= newSplit.length;
        }
        const oldHunk = `${oldStart}${oldLinesCount !== 1 ? `,${oldLinesCount}` : ""}`;
        const newHunk = `${newStart}${newLinesCount !== 1 ? `,${newLinesCount}` : ""}`;
        source.push({ text: `@@ -${oldHunk} +${newHunk} @@`, token: "codeBg", diffKind: "hunk" });
        const maxLine = Math.max(oldStart + oldLinesCount, newStart + newLinesCount, 1);
        const gutterWidth = Math.max(3, String(maxLine).length);
        let curOld = oldStart === 0 ? 1 : oldStart;
        let curNew = newStart === 0 ? 1 : newStart;
        for (const raw of lines) {
          if (raw.startsWith("\\")) continue;
          if (raw.startsWith("-")) {
            const num = String(curOld).padStart(gutterWidth, " ");
            source.push({ text: `${num} \u2502 - ${raw.slice(1)}`, token: "codeBg", diffKind: "delete" });
            curOld++;
          } else if (raw.startsWith("+")) {
            const num = String(curNew).padStart(gutterWidth, " ");
            source.push({ text: `${num} \u2502 + ${raw.slice(1)}`, token: "codeBg", diffKind: "add" });
            curNew++;
          } else if (raw.startsWith(" ")) {
            const num = String(curNew).padStart(gutterWidth, " ");
            source.push({ text: `${num} \u2502   ${raw.slice(1)}`, token: "codeBg", diffKind: "context" });
            curOld++;
            curNew++;
          } else {
            const num = String(curNew).padStart(gutterWidth, " ");
            source.push({ text: `${num} \u2502   ${raw}`, token: "codeBg", diffKind: "context" });
            curOld++;
            curNew++;
          }
        }
      }
      section("diff", source.build());
      break;
    }
    case "search": {
      if (result?.card !== "search") break;
      const source = new RowSequence();
      if (result.shape === "matches") {
        for (const file of result.files) source.append(indexedRows(file.matches.length, (index) => {
          const match = file.matches[index];
          return { text: `${file.path}:${match.lineNumber} ${match.line}`, token: "codeBg" };
        }));
      } else source.append(indexedRows(result.paths.length, (index) => ({ text: result.paths[index], token: "codeBg" })));
      if (result.truncated) source.push({ text: "\u2026", token: "codeBg" });
      section(tuiCopy("result", options.locale), source.build());
      break;
    }
    case "read":
      if (result?.card === "read") section(tuiCopy("result", options.locale), indexedRows(result.lines.length, (index) => {
        const line5 = result.lines[index];
        return { text: `${line5.number} ${line5.text}`, token: "codeBg" };
      }));
      break;
    case "web":
      if (result?.card === "web") {
        if (result.kind === "fetch") section(tuiCopy("result", options.locale), textLines(`${result.url} \xB7 ${result.statusCode}`));
        else {
          section(tuiCopy("result", options.locale), indexedRows(result.sources.length, (index) => {
            const source = result.sources[index];
            return { text: source.title === void 0 ? source.url : `${source.title} \xB7 ${source.url}`, token: "codeBg" };
          }));
          if (result.truncated) rows.push({ text: "\u2026", token: "codeBg" });
        }
      }
      break;
    default: {
      const isSubagent = card.name === "subagent" || card.name.startsWith("subagent_") || card.name === "delegate";
      const subInfo = isSubagent ? parseSubagentArguments(card.arguments) : void 0;
      if (subInfo !== void 0) {
        if (subInfo.description !== void 0) {
          section(options.locale === "zh-CN" ? "\u4EFB\u52A1\u76EE\u6807" : "Task", textLines(subInfo.description));
        }
        if (subInfo.model !== void 0) {
          section(options.locale === "zh-CN" ? "\u59D4\u6D3E\u6A21\u578B" : "Model", textLines(subInfo.model));
        }
        if (card.status === "running") {
          section(
            options.locale === "zh-CN" ? "\u8FD0\u884C\u72B6\u6001" : "Status",
            textLines(options.locale === "zh-CN" ? "\u25CF \u6B63\u5728\u6267\u884C\u5B50\u4EE3\u7406\u4EFB\u52A1..." : "\u25CF Running subagent task...")
          );
        }
        if (subInfo.prompt !== void 0) {
          section(options.locale === "zh-CN" ? "\u4EFB\u52A1\u6307\u4EE4" : "Prompt", textLines(subInfo.prompt));
        }
      } else {
        args();
      }
      if (card.resultText !== void 0) section(tuiCopy("result", options.locale), textLines(card.resultText));
      break;
    }
  }
  if (result === void 0 && kind !== "generic" && card.resultText !== void 0) {
    section(tuiCopy("result", options.locale), textLines(card.resultText));
  }
  if (rows.length === bodyStart && !options.includeArguments) args();
  if (options.diagnostics && card.meta !== void 0) section(tuiCopy("diagnostics", options.locale), textLines(JSON.stringify(card.meta)));
  return rows.build();
}
function escapeToolText(text) {
  return escapeContent(text).replace(/\t/gu, "\\t");
}
function fragmentEnd(text, start, width) {
  let columns = 0;
  let end = start;
  for (const part of graphemes.segment(text.slice(start))) {
    const size = displayWidth(escapeToolText(part.segment));
    if (columns + size > width && end > start) break;
    end += part.segment.length;
    columns += size;
    if (columns >= width) break;
  }
  return end;
}
function planToolBodyWindow(document, cursor, width, maxRows) {
  const fragments = [];
  let line5 = cursor.line;
  let offset = cursor.offset;
  while (line5 < document.length && fragments.length < maxRows) {
    const source = document.at(line5);
    const end = fragmentEnd(source.text, offset, width);
    fragments.push({ line: line5, start: offset, end });
    if (end === source.text.length) {
      line5 += 1;
      offset = 0;
    } else offset = end;
  }
  return { fragments, next: line5 < document.length ? { line: line5, offset } : void 0, remainingLines: document.length - line5 };
}
function materializeToolBodyRow(document, fragment) {
  const source = document.at(fragment.line);
  return {
    text: escapeToolText(source.text.slice(fragment.start, fragment.end)),
    token: source.token,
    ...source.diffKind !== void 0 ? { diffKind: source.diffKind } : {}
  };
}
function toolCardOriginalText(card, options) {
  const parts = [card.name, tuiCopy("arguments", options.locale), card.arguments];
  if (card.resultText !== void 0) parts.push(tuiCopy("result", options.locale), card.resultText);
  if (options.diagnostics && card.meta !== void 0) parts.push(tuiCopy("diagnostics", options.locale), JSON.stringify(card.meta));
  return `${parts.join("\n")}
`;
}

// tui-render/src/tool-rows.ts
var graphemes2 = new Intl.Segmenter(void 0, { granularity: "grapheme" });
function truncateMiddleDisplay(text, maxCols, leadingShare = 0.5) {
  if (maxCols <= 0) return "";
  if (displayWidth(text) <= maxCols) return text;
  if (maxCols === 1) return "\u2026";
  const budget = maxCols - 1;
  const headBudget = Math.max(1, Math.min(budget, Math.ceil(budget * leadingShare)));
  const parts = Array.from(graphemes2.segment(text), (part) => part.segment);
  const take = (items, available) => {
    const out = [];
    let used = 0;
    for (const item of items) {
      used += displayWidth(item);
      if (used > available) break;
      out.push(item);
    }
    return out;
  };
  return `${take(parts, headBudget).join("")}\u2026${take(parts.reverse(), budget - headBudget).reverse().join("")}`;
}
function toolRow(parts, index, width, background) {
  let column = 0;
  const spans = parts.map((part) => {
    const start = column;
    column += displayWidth(part.text);
    return { start, end: column, token: part.token, bold: false, ...part.href === void 0 ? {} : { href: part.href } };
  });
  return {
    text: parts.map((part) => part.text).join(""),
    displayWidth: column,
    spans,
    rowInBlock: index,
    sourceStart: -1,
    sourceEnd: -1,
    rawTail: false,
    background,
    backgroundColumns: width
  };
}
function toolHeadingRow(card, width, expanded, locale) {
  const status = toolCardDisplayStatus(card);
  const glyph = expanded ? "\u25BE" : "\u25B8";
  const isSubagent = card.name === "subagent" || card.name.startsWith("subagent_") || card.name === "delegate";
  const subagentInfo = isSubagent ? parseSubagentArguments(card.arguments) : void 0;
  if (isSubagent) {
    const statusLabel = status === "ok" ? locale === "zh-CN" ? "\u2713 \u5DF2\u5B8C\u6210" : "\u2713 completed" : status === "error" ? locale === "zh-CN" ? "\u2717 \u5931\u8D25" : "\u2717 failed" : locale === "zh-CN" ? "\u25CF \u8FD0\u884C\u4E2D" : "\u25CF running";
    const statusToken2 = status === "error" ? "error" : status === "running" ? "accentText" : "success";
    const glyphToken = status === "running" ? "accentText" : "fgDim";
    const tag = locale === "zh-CN" ? "[\u5B50\u4EE3\u7406] " : "[Subagent] ";
    if (width < displayWidth(`${glyph} \u2026 \xB7 ${statusLabel}`)) {
      return toolRow([{ text: truncateDisplay(`${glyph} ${statusLabel}`, width), token: statusToken2 }], 0, width, "toolBg");
    }
    const headingText = subagentInfo?.description !== void 0 && subagentInfo.description !== "" ? subagentInfo.description : card.resultView?.title ?? card.callView?.title ?? card.name;
    const heading2 = escapeContent(headingText).replace(/[\n\t]/gu, " ");
    const prefixBudget = displayWidth(`${glyph} ${tag} \xB7 ${statusLabel}`);
    const fitted2 = truncateMiddleDisplay(heading2, Math.max(1, width - prefixBudget), 0.6);
    const parts2 = [
      { text: `${glyph} `, token: glyphToken },
      { text: tag, token: "codeKeyword" },
      { text: `${fitted2} \xB7 `, token: "fg" },
      { text: statusLabel, token: statusToken2 }
    ];
    if (subagentInfo?.model !== void 0) {
      parts2.push({ text: ` [${subagentInfo.model}]`, token: "markdownCode" });
    }
    let summary2;
    if (status === "error") {
      summary2 = collapsedToolCardSummary(card);
    } else if (!expanded) {
      if (subagentInfo?.prompt !== void 0 && subagentInfo.prompt !== "") {
        summary2 = escapeContent(subagentInfo.prompt).replace(/\n/g, " ");
      } else {
        summary2 = collapsedToolCardSummary(card);
      }
    }
    const available2 = width - parts2.reduce((sum, part) => sum + displayWidth(part.text), 0) - 1;
    const href2 = fileUrlFromToolArguments(card.arguments);
    if (summary2 !== void 0 && available2 >= 2) {
      parts2.push({ text: ` ${truncateDisplay(summary2, available2)}`, token: "fgSoft", ...href2 === void 0 ? {} : { href: href2 } });
    }
    return toolRow(parts2, 0, width, "toolBg");
  }
  const label = status === "ok" ? "\u2713" : tuiCopy(status === "error" ? "failed" : "running", locale);
  if (width < displayWidth(`${glyph} \u2026 \xB7 ${label}`)) return toolRow([{ text: truncateDisplay(`${glyph} ${label}`, width), token: status === "error" ? "error" : "fgDim" }], 0, width, "toolBg");
  const heading = escapeContent(card.resultView?.title ?? card.callView?.title ?? card.name).replace(/[\n\t]/gu, " ");
  const terminal = card.callView?.card === "terminal" || card.resultView?.card === "terminal";
  const fitted = truncateMiddleDisplay(heading, Math.max(1, width - displayWidth(`${glyph}  \xB7 ${label}`)), terminal ? 0.72 : 0.5);
  const parts = expanded && terminal ? [{ text: `${glyph} `, token: "fgDim" }, ...tokenizeCommandHeading(fitted), { text: " \xB7 ", token: "fgDim" }] : [{ text: `${glyph} ${fitted} \xB7 `, token: "fgSoft" }];
  parts.push({ text: label, token: status === "error" ? "error" : status === "running" ? "accentText" : "fgDim" });
  const summary = !expanded || status === "error" ? collapsedToolCardSummary(card) : void 0;
  const available = width - parts.reduce((sum, part) => sum + displayWidth(part.text), 0) - 1;
  const href = fileUrlFromToolArguments(card.arguments);
  if (summary !== void 0 && available >= 2) parts.push({ text: ` ${truncateDisplay(summary, available)}`, token: "fgDim", ...href === void 0 ? {} : { href } });
  return toolRow(parts, 0, width, "toolBg");
}
var GUTTER_SEPARATOR = " \u2502 ";
function inferDiffKind(text) {
  if (text.startsWith("--- ")) return "header";
  if (/^@@ -\d+.* @@$/u.test(text)) return "hunk";
  if (text.includes(" \u2502 + ")) return "add";
  if (text.includes(" \u2502 - ")) return "delete";
  if (/^\s*\d+ │ /u.test(text)) return "context";
  return void 0;
}
function formatDiffParts(text, kind) {
  switch (kind) {
    case "header":
      return [{ text: `  ${text}`, token: "fgDim" }];
    case "hunk":
      return [{ text: `  ${text}`, token: "accentText" }];
    case "add": {
      const sepIndex = text.indexOf(GUTTER_SEPARATOR);
      if (sepIndex !== -1) {
        const gutter = text.slice(0, sepIndex + GUTTER_SEPARATOR.length);
        const content = text.slice(sepIndex + GUTTER_SEPARATOR.length);
        return [
          { text: `  ${gutter}`, token: "fgDim" },
          { text: content, token: "success" }
        ];
      }
      return [{ text: `  ${text}`, token: "success" }];
    }
    case "delete": {
      const sepIndex = text.indexOf(GUTTER_SEPARATOR);
      if (sepIndex !== -1) {
        const gutter = text.slice(0, sepIndex + GUTTER_SEPARATOR.length);
        const content = text.slice(sepIndex + GUTTER_SEPARATOR.length);
        return [
          { text: `  ${gutter}`, token: "fgDim" },
          { text: content, token: "error" }
        ];
      }
      return [{ text: `  ${text}`, token: "error" }];
    }
    case "context": {
      const sepIndex = text.indexOf(GUTTER_SEPARATOR);
      if (sepIndex !== -1) {
        const gutter = text.slice(0, sepIndex + GUTTER_SEPARATOR.length);
        const content = text.slice(sepIndex + GUTTER_SEPARATOR.length);
        return [
          { text: `  ${gutter}`, token: "fgDim" },
          { text: content, token: "fgSoft" }
        ];
      }
      return [{ text: `  ${text}`, token: "fgSoft" }];
    }
  }
}
function toolBodyRenderRow(line5, index, width) {
  const bg = line5.token === "codeBg" ? "codeBg" : "toolBg";
  const diffKind = line5.diffKind ?? inferDiffKind(line5.text);
  if (diffKind !== void 0) {
    return toolRow(formatDiffParts(line5.text, diffKind), index, width, bg);
  }
  if (line5.text.includes("\u25CF \u6B63\u5728\u6267\u884C") || line5.text.includes("\u25CF Running")) {
    return toolRow([{ text: `  ${line5.text}`, token: "accentText" }], index, width, bg);
  }
  return toolRow([{ text: `  ${line5.text}`, token: line5.token === "codeBg" ? "fgSoft" : "fgDim" }], index, width, bg);
}
function toolRemainingRow(remaining, width, index, locale) {
  const action = tuiCopy("toolDetails", locale);
  const hint = `  ${action} \xB7 ${remaining} ${tuiCopy("remaining", locale)}`;
  return toolRow([{ text: truncateDisplay(hint, width), token: "fgDim" }], index, width, "toolBg");
}
function sameCard(left, right) {
  return left.name === right.name && left.arguments === right.arguments && left.resultText === right.resultText && left.status === right.status && left.callView === right.callView && left.resultView === right.resultView && left.meta === right.meta && left.error === right.error;
}
var ToolRowCache = class {
  /** @param policy - host-validated per-document and total cache budgets. */
  constructor(policy) {
    this.policy = policy;
  }
  policy;
  entries = /* @__PURE__ */ new Map();
  rowCount = 0;
  materialized = 0;
  evictions = 0;
  /**
   * Publish a known-height preview without materializing its body.
   * @param id - stable tool id, independent of neighboring hidden parts.
   * @param card - immutable canonical revision and presenter views.
   * @param width - full card width.
   * @param expanded - global disclosure intent.
   * @param locale - display-copy locale.
   * @returns random-access rows whose evicted data can be rebuilt from canonical fields.
   */
  rows(id, card, width, expanded, locale) {
    const key = `${id}\0${width}\0${expanded}\0${locale}`;
    const ensure = () => {
      const cached = this.entries.get(key);
      if (cached !== void 0 && sameCard(cached.card, card)) {
        this.entries.delete(key);
        this.entries.set(key, cached);
        return cached;
      }
      if (cached !== void 0) this.remove(key, cached);
      const document = expanded ? createToolBodyDocument(card, { diagnostics: false, includeArguments: false, locale }) : void 0;
      const isDiff = card.callView?.card === "diff" || card.resultView?.card === "diff";
      const rowBudget = isDiff ? this.policy.diffPreviewRows : this.policy.previewRows;
      const window = document === void 0 ? void 0 : planToolBodyWindow(document, { line: 0, offset: 0 }, Math.max(1, width - 2), rowBudget);
      const entry = {
        card,
        document,
        window,
        rows: /* @__PURE__ */ new Map(),
        length: 1 + (window?.fragments.length ?? 0) + (window?.next === void 0 ? 0 : 1)
      };
      this.entries.set(key, entry);
      this.trim();
      return entry;
    };
    const length = ensure().length;
    return indexedRows(length, (index) => {
      const entry = ensure();
      const cached = entry.rows.get(index);
      if (cached !== void 0) return cached;
      const fragment = entry.window?.fragments[index - 1];
      const row = index === 0 ? toolHeadingRow(card, width, expanded, locale) : fragment === void 0 ? toolRemainingRow(entry.window?.remainingLines ?? 0, width, index, locale) : toolBodyRenderRow(materializeToolBodyRow(entry.document, fragment), index, width);
      entry.rows.set(index, row);
      this.rowCount += 1;
      this.materialized += 1;
      this.trim();
      return row;
    });
  }
  /** Release derived documents and rows; canonical session data belongs to the caller. */
  clear() {
    this.entries.clear();
    this.rowCount = 0;
  }
  /**
   * Read current cache occupancy and lifetime construction work.
   * @returns cache occupancy and cumulative materialization/eviction counts.
   */
  stats() {
    return { entries: this.entries.size, rows: this.rowCount, materialized: this.materialized, evictions: this.evictions };
  }
  remove(key, entry) {
    this.entries.delete(key);
    this.rowCount -= entry.rows.size;
    this.evictions += 1;
  }
  trim() {
    while (this.entries.size > this.policy.cacheEntries || this.rowCount > this.policy.cacheRows) {
      const [key, entry] = this.entries.entries().next().value;
      this.remove(key, entry);
    }
  }
};

// tui-render/src/render-policy.ts
var RENDER_POLICY_DEFAULT_STREAM_FRAME_INTERVAL_MS = 16;
var RENDER_POLICY_DEFAULT_STREAM_ENTRY_DEPTH = 64;
var RENDER_POLICY_DEFAULT_STREAM_EXIT_DEPTH = 32;
var RENDER_POLICY_DEFAULT_STREAM_ENTRY_OLDEST_AGE_MS = 500;
var RENDER_POLICY_DEFAULT_STREAM_EXIT_OLDEST_AGE_MS = 250;
var RENDER_POLICY_DEFAULT_STREAM_ENTRY_DRAIN_BACKPRESSURE_MS = 100;
var RENDER_POLICY_DEFAULT_STREAM_EXIT_DRAIN_BACKPRESSURE_MS = 50;
var RENDER_POLICY_DEFAULT_STREAM_CATCH_UP_ROWS_PER_FRAME = 16;
var RENDER_POLICY_DEFAULT_SCROLL_FRAME_INTERVAL_MS = 16;
var RENDER_POLICY_DEFAULT_SCROLL_STEP_PER_FRAME = 1;
var RENDER_POLICY_DEFAULT_SCROLL_WHEEL_ROWS = 3;
var RENDER_POLICY_DEFAULT_SCROLL_CATCH_UP_THRESHOLD = 10;
var RENDER_POLICY_DEFAULT_SCROLL_MAX_CATCH_UP_STEP = 8;
var RENDER_POLICY_DEFAULT_CACHE_MAX_ROWS = 65536;
var RENDER_POLICY_DEFAULT_CACHE_MAX_BYTES = 32 * 1024 * 1024;
var RENDER_POLICY_DEFAULT_TRANSCRIPT_OVERSCAN = 16;
var RENDER_POLICY_MAX_OVERSCAN = 50;
var RENDER_POLICY_MAX_CACHE_ROWS = 1e6;
var RENDER_POLICY_MAX_CACHE_BYTES = 64 * 1024 * 1024;
function toolPolicyDefaults() {
  return { previewRows: 6, diffPreviewRows: 200, detailPageRows: 40, cacheEntries: 512, cacheRows: 16384 };
}
function renderPolicyDefaults() {
  return {
    transcriptOverscan: RENDER_POLICY_DEFAULT_TRANSCRIPT_OVERSCAN,
    stream: {
      frameIntervalMs: RENDER_POLICY_DEFAULT_STREAM_FRAME_INTERVAL_MS,
      entryDepth: RENDER_POLICY_DEFAULT_STREAM_ENTRY_DEPTH,
      exitDepth: RENDER_POLICY_DEFAULT_STREAM_EXIT_DEPTH,
      entryOldestAgeMs: RENDER_POLICY_DEFAULT_STREAM_ENTRY_OLDEST_AGE_MS,
      exitOldestAgeMs: RENDER_POLICY_DEFAULT_STREAM_EXIT_OLDEST_AGE_MS,
      entryDrainBackpressureMs: RENDER_POLICY_DEFAULT_STREAM_ENTRY_DRAIN_BACKPRESSURE_MS,
      exitDrainBackpressureMs: RENDER_POLICY_DEFAULT_STREAM_EXIT_DRAIN_BACKPRESSURE_MS,
      catchUpRowsPerFrame: RENDER_POLICY_DEFAULT_STREAM_CATCH_UP_ROWS_PER_FRAME
    },
    scroll: {
      frameIntervalMs: RENDER_POLICY_DEFAULT_SCROLL_FRAME_INTERVAL_MS,
      stepPerFrame: RENDER_POLICY_DEFAULT_SCROLL_STEP_PER_FRAME,
      wheelRows: RENDER_POLICY_DEFAULT_SCROLL_WHEEL_ROWS,
      catchUpThreshold: RENDER_POLICY_DEFAULT_SCROLL_CATCH_UP_THRESHOLD,
      maxCatchUpStep: RENDER_POLICY_DEFAULT_SCROLL_MAX_CATCH_UP_STEP
    },
    cache: {
      maxRows: RENDER_POLICY_DEFAULT_CACHE_MAX_ROWS,
      maxBytes: RENDER_POLICY_DEFAULT_CACHE_MAX_BYTES
    },
    tools: toolPolicyDefaults()
  };
}

// tui-render/src/tool-card.tsx
import { jsx as jsx4 } from "react/jsx-runtime";
function ToolCard({ card, expanded = false, maxCols = 80, locale = "zh-CN", policy = toolPolicyDefaults() }) {
  const cache2 = new ToolRowCache(policy);
  const rows = cache2.rows(card.callId, card, maxCols, expanded, locale).slice();
  return /* @__PURE__ */ jsx4(Box4, { flexDirection: "column", width: "100%", backgroundColor: inkColor("toolBg"), children: rows.map((line5, index) => /* @__PURE__ */ jsx4(Text4, { wrap: "truncate", children: paintLineFromRenderLine(line5, hyperlinksEnabled()) }, index)) });
}

// tui-render/src/tool-presenter-cache.ts
var ToolPresenterCache = class {
  /** @param capacity - maximum retained tool revisions, validated by the host. */
  constructor(capacity) {
    this.capacity = capacity;
  }
  capacity;
  entries = /* @__PURE__ */ new Map();
  /**
   * Attach views once for an unchanged call/result and presenter registration.
   * @param lookup - current tool registry.
   * @param card - canonical paired tool data.
   * @returns presenter-enriched data, or the generic fallback.
   */
  present(lookup, card) {
    const definition = lookup?.get(card.name);
    const cached = this.entries.get(card.callId);
    if (cached !== void 0 && cached.definition === definition && cached.input.name === card.name && cached.input.arguments === card.arguments && cached.input.resultText === card.resultText && cached.input.status === card.status && cached.input.meta === card.meta && cached.input.error === card.error) {
      this.entries.delete(card.callId);
      this.entries.set(card.callId, cached);
      return cached.output;
    }
    const output = attachPresenterViews(definition === void 0 ? void 0 : { get: () => definition }, card);
    this.entries.delete(card.callId);
    this.entries.set(card.callId, { input: card, output, definition });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value);
    return output;
  }
  /** Release presenter-derived data when the transcript owner unmounts. */
  clear() {
    this.entries.clear();
  }
};

// tui-render/src/display-revision.ts
var DisplayRevisionIndex = class {
  next = 0;
  entries = /* @__PURE__ */ new WeakMap();
  /**
   * Assign a short revision when an owner or one of its explicit fields changes.
   * @param owner - immutable history row, or stable mutable active-view owner.
   * @param fields - primitive values and immutable object references; no serialized transcript text.
   * @returns stable process-local revision until these fields change.
   */
  revision(owner, fields = []) {
    const previous = this.entries.get(owner);
    if (previous !== void 0 && fields.length === previous.fields.length && fields.every((field, index) => Object.is(field, previous.fields[index]))) return previous.version;
    const version = String(++this.next);
    this.entries.set(owner, { fields: fields.slice(), version });
    return version;
  }
};

// tui-render/src/plain-rows.ts
var PlainTextRowCache = class {
  /** @param policy - host-validated row and byte budgets for derived text. */
  constructor(policy) {
    this.policy = policy;
  }
  policy;
  entries = /* @__PURE__ */ new Map();
  bytes = 0;
  count = 0;
  /**
   * Index complete source lines while deferring styled row creation to viewport reads.
   * @param id - stable owning text id.
   * @param source - canonical, unabridged reasoning text.
   * @param width - body width excluding its two-column indentation.
   * @param backgroundColumns - optional surface width in terminal columns.
   * @param background - optional surface token painted behind every row.
   * @returns every physical body row; the main transcript owns clipping and scrolling.
   */
  rows(id, source, width, backgroundColumns, background = "toolBg") {
    const key = `${id}\0${width}\0${backgroundColumns ?? ""}\0${background}`;
    const cached = this.entries.get(key);
    if (cached?.source === source) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.rows;
    }
    if (cached !== void 0) this.remove(key, cached);
    for (const entry of this.entries.values()) {
      if (entry.source === source && entry.naturalWidth <= Math.min(width, entry.width) && (backgroundColumns === void 0 || entry.backgroundColumns === backgroundColumns) && entry.background === background) {
        this.remember(key, entry);
        return entry.rows;
      }
    }
    const wrapped = [];
    let naturalWidth = 0;
    for (const line5 of escapeContent(source).replace(/\t/gu, "\\t").split("\n")) {
      const columns = displayWidth(line5);
      naturalWidth = Math.max(naturalWidth, columns);
      if (columns <= width) wrapped.push(line5);
      else wrapped.push(...wrapDisplayLines(line5, width));
    }
    const materialized = /* @__PURE__ */ new Map();
    const rows = indexedRows(wrapped.length, (index) => {
      const hit = materialized.get(index);
      if (hit !== void 0) return hit;
      const text = `\u2502 ${wrapped[index]}`;
      const columns = displayWidth(text);
      const row = {
        text,
        displayWidth: columns,
        spans: [
          { start: 0, end: 2, token: "accentText", bold: false },
          { start: 2, end: columns, token: "fgDim", bold: false }
        ],
        rowInBlock: index + 1,
        sourceStart: -1,
        sourceEnd: -1,
        rawTail: false,
        background,
        ...backgroundColumns !== void 0 ? { backgroundColumns } : {}
      };
      materialized.set(index, row);
      return row;
    });
    this.remember(key, {
      source,
      rows,
      naturalWidth,
      width,
      bytes: Buffer.byteLength(source) + wrapped.length * 128,
      ...backgroundColumns !== void 0 ? { backgroundColumns } : {},
      background
    });
    return rows;
  }
  remember(key, entry) {
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    this.count += entry.rows.length;
    while (this.bytes > this.policy.maxBytes || this.count > this.policy.maxRows) {
      const [oldKey, oldEntry] = this.entries.entries().next().value;
      this.remove(oldKey, oldEntry);
    }
  }
  /** Release derived data without modifying the owning session's text. */
  clear() {
    this.entries.clear();
    this.bytes = 0;
    this.count = 0;
  }
  remove(key, entry) {
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    this.count -= entry.rows.length;
  }
};

// tui-render/src/pixel-fish-home.tsx
import { Box as Box5, Text as Text5 } from "ink";
import { useEffect, useRef as useRef2, useState } from "react";

// tui-render/src/duration-stats.ts
import { createHistogram } from "node:perf_hooks";
var DurationStats = class {
  /** @param capacity - number of exact recent samples retained for diagnostics. */
  constructor(capacity) {
    this.capacity = capacity;
  }
  capacity;
  histogram = createHistogram({ figures: 3 });
  recent = [];
  count = 0;
  sum = 0;
  max = 0;
  /**
   * Record one duration in both the recent window and lifetime distribution.
   * @param milliseconds - non-negative monotonic-clock duration.
   */
  record(milliseconds) {
    this.recent.push(milliseconds);
    if (this.recent.length > this.capacity) this.recent.shift();
    this.count += 1;
    this.sum += milliseconds;
    this.max = Math.max(this.max, milliseconds);
    this.histogram.record(Math.max(1, Math.round(milliseconds * 1e3)));
  }
  /** Clear the recent diagnostic window while retaining every lifetime observation. */
  resetWindow() {
    this.recent.length = 0;
  }
  /** Start a new measured workload, discarding both startup samples and their distribution. */
  reset() {
    this.resetWindow();
    this.histogram.reset();
    this.count = 0;
    this.sum = 0;
    this.max = 0;
  }
  /**
   * Read the recent window and complete measured workload without clearing either.
   * @returns recent exact quantiles plus full-run count, mean, max, and histogram quantiles.
   */
  snapshot() {
    const samples = this.recent.slice();
    const sorted = samples.slice().sort((left, right) => left - right);
    const count = samples.length;
    const percentile = (quantile) => sorted[Math.ceil(count * quantile) - 1] ?? 0;
    return {
      count,
      mean: count === 0 ? 0 : samples.reduce((sum, sample) => sum + sample, 0) / count,
      max: sorted.at(-1) ?? 0,
      p95: percentile(0.95),
      p99: percentile(0.99),
      samples,
      run: {
        count: this.count,
        mean: this.count === 0 ? 0 : this.sum / this.count,
        max: this.max,
        p95: this.max === 0 ? 0 : Math.min(this.max, this.histogram.percentile(95) / 1e3),
        p99: this.max === 0 ? 0 : Math.min(this.max, this.histogram.percentile(99) / 1e3)
      }
    };
  }
};

// tui-render/src/frame-stats.ts
import { createElement, Profiler } from "react";
var FRAME_STATS_CAPACITY = 120;
function createFrameProbe(now = () => performance.now(), capacity = FRAME_STATS_CAPACITY) {
  const samples = new DurationStats(capacity);
  let startedAt = now();
  let commits = 0;
  let measurementStarted = false;
  return {
    record(renderMs) {
      commits += 1;
      samples.record(renderMs);
    },
    snapshot() {
      return samples.snapshot();
    },
    beginMeasurement() {
      if (measurementStarted) return;
      measurementStarted = true;
      samples.reset();
      commits = 0;
      startedAt = now();
    },
    get commits() {
      return commits;
    },
    elapsedMs() {
      return now() - startedAt;
    }
  };
}
function frameStatsSnapshot(probe) {
  return probe.snapshot();
}
function FrameProbe(props) {
  const { probe, children } = props;
  return createElement(
    Profiler,
    { id: "dsh-tui-render", onRender: profilerOnRender(probe) },
    children
  );
}
function profilerOnRender(probe) {
  return (_id, _phase, actualDuration) => {
    probe.record(actualDuration);
  };
}

// tui-render/src/pixel-fish-home.tsx
import { jsx as jsx5, jsxs as jsxs4 } from "react/jsx-runtime";
var BRAND_FRAME_MS = 320;
var BRAND_ART_ROWS = BRAND_HALF_BLOCK.length;
var BRAND_MIN_HOME_ROWS = BRAND_ART_ROWS + 2;
var BRAND_HOME_ROWS = BRAND_ART_ROWS + 3;
var activeRevealTimers = 0;
function activeBrandRevealTimerCount() {
  return activeRevealTimers;
}
var TIER_ORDER = [
  "half-block",
  "full-block",
  "ascii"
];
function rowsForTier(tier) {
  switch (tier) {
    case "half-block":
      return BRAND_HALF_BLOCK;
    case "full-block":
      return BRAND_FULL_BLOCK;
    case "ascii":
      return BRAND_ASCII;
  }
}
function rowsFit(rows, maxColumns, maxRows) {
  return maxRows >= BRAND_MIN_HOME_ROWS && rows.length === BRAND_ART_ROWS && rows.every((row) => displayWidth(row) <= maxColumns);
}
function selectBrandRenderTier(preferred, maxColumns, maxRows) {
  if (preferred === "plain") return "plain";
  const start = TIER_ORDER.indexOf(preferred);
  for (const tier of TIER_ORDER.slice(start)) {
    if (rowsFit(rowsForTier(tier), maxColumns, maxRows)) return tier;
  }
  return "plain";
}
function PixelFishHome({
  tier,
  animate,
  visible,
  maxColumns,
  maxRows,
  frameProbe
}) {
  const selected = selectBrandRenderTier(tier, maxColumns, maxRows);
  const [frameIndex, setFrameIndex] = useState(void 0);
  const timerRef = useRef2(void 0);
  const revealStartedRef = useRef2(false);
  const clearTimer = () => {
    if (timerRef.current === void 0) return;
    clearTimeout(timerRef.current);
    timerRef.current = void 0;
    activeRevealTimers -= 1;
  };
  const armTimer = (callback) => {
    timerRef.current = setTimeout(() => {
      timerRef.current = void 0;
      activeRevealTimers -= 1;
      callback();
    }, BRAND_FRAME_MS);
    activeRevealTimers += 1;
  };
  useEffect(() => {
    clearTimer();
    setFrameIndex(void 0);
    if (!visible || !animate || selected !== "half-block") return;
    if (revealStartedRef.current) return;
    revealStartedRef.current = true;
    let nextFrame = 1;
    setFrameIndex(0);
    const advance = () => {
      if (nextFrame >= BRAND_HALF_BLOCK_FRAMES.length) {
        setFrameIndex(void 0);
        return;
      }
      setFrameIndex(nextFrame);
      nextFrame += 1;
      armTimer(advance);
    };
    armTimer(advance);
    return clearTimer;
  }, [animate, selected, visible]);
  const rows = selected === "plain" ? void 0 : selected === "half-block" && frameIndex !== void 0 ? BRAND_HALF_BLOCK_FRAMES[frameIndex] : rowsForTier(selected);
  const artWidth = rows === void 0 ? 0 : Math.max(0, ...rows.map(displayWidth));
  const home = /* @__PURE__ */ jsxs4(Box5, { flexDirection: "column", alignItems: "center", width: "100%", children: [
    rows === void 0 ? null : /* @__PURE__ */ jsx5(Box5, { flexDirection: "column", width: artWidth, children: rows.map((row, index) => /* @__PURE__ */ jsx5(Text5, { children: paintRow([styled(row, "accent")]) }, `fish-${String(index)}`)) }),
    /* @__PURE__ */ jsx5(Text5, { children: paintRow([styled(BRAND_PLAIN_WORDMARK, "accent", void 0, true)]) }),
    maxRows >= BRAND_HOME_ROWS ? /* @__PURE__ */ jsx5(Text5, { children: paintRow([styled(" ", "bg")]) }) : null,
    /* @__PURE__ */ jsx5(Text5, { children: paintRow([styled(BRAND_HOME_LINE, "fg")]) })
  ] });
  return frameProbe === void 0 ? home : /* @__PURE__ */ jsx5(FrameProbe, { probe: frameProbe, children: home });
}

// tui-render/src/conversation-layout.ts
var WIDE_GUTTER_COLUMNS = 2;
var GUTTER_BREAKPOINT_COLUMNS = 40;
function conversationWidth(columns) {
  if (columns < GUTTER_BREAKPOINT_COLUMNS) return Math.max(1, columns);
  return Math.max(1, columns - WIDE_GUTTER_COLUMNS * 2);
}
function conversationLeft(columns, width) {
  return Math.max(0, Math.ceil((columns - width) / 2));
}

// tui-render/src/transcript-viewport.ts
var EMPTY_TRANSCRIPT_VIEWPORT = Object.freeze({
  follow: true,
  offsetFromBottom: 0,
  unseenRows: 0,
  contentRows: 0,
  viewportRows: 0,
  blocks: Object.freeze([])
});
function maxOffset(contentRows, viewportRows) {
  return Math.max(0, contentRows - viewportRows);
}
function clampOffset(value, contentRows, viewportRows) {
  return Math.max(0, Math.min(value, maxOffset(contentRows, viewportRows)));
}
function topRow(state) {
  return Math.max(0, state.contentRows - state.viewportRows - state.offsetFromBottom);
}
function anchorForRow(row, blocks, viewportRow = 0) {
  if (blocks.length === 0) return void 0;
  const containing = blocks.find((block2) => row >= block2.top && row < block2.top + block2.rows);
  const block = containing ?? blocks.findLast((candidate) => candidate.top <= row) ?? blocks[0];
  if (block === void 0) return void 0;
  return {
    blockId: block.id,
    rowWithinBlock: Math.max(0, Math.min(row - block.top, Math.max(0, block.rows - 1))),
    viewportRow
  };
}
function recoverAnchorBlock(state, blocks) {
  const anchor = state.anchor;
  if (anchor === void 0) return void 0;
  const exact = blocks.find((block) => block.id === anchor.blockId);
  if (exact !== void 0) return exact;
  const previousIndex = state.blocks.findIndex((block) => block.id === anchor.blockId);
  if (previousIndex < 0) return void 0;
  for (let index = previousIndex - 1; index >= 0; index -= 1) {
    const previous = state.blocks[index];
    if (previous === void 0) continue;
    const recovered = blocks.find((block) => block.id === previous.id);
    if (recovered !== void 0) return recovered;
  }
  return blocks[0];
}
function sameBlocks(left, right) {
  return left.length === right.length && left.every((block, index) => {
    const other = right[index];
    return other !== void 0 && block.id === other.id && block.top === other.top && block.rows === other.rows;
  });
}
function layoutState(state, action) {
  const contentRows = Math.max(0, action.contentRows);
  const viewportRows = Math.max(0, action.viewportRows);
  const blocks = Object.freeze([...action.blocks]);
  if (state.follow) {
    if (state.contentRows === contentRows && state.viewportRows === viewportRows && state.offsetFromBottom === 0 && state.unseenRows === 0 && sameBlocks(state.blocks, blocks)) return state;
    return {
      follow: true,
      offsetFromBottom: 0,
      unseenRows: 0,
      contentRows,
      viewportRows,
      blocks
    };
  }
  const recovered = recoverAnchorBlock(state, blocks);
  let offsetFromBottom;
  if (recovered !== void 0 && state.anchor !== void 0) {
    const anchoredRow = recovered.top + Math.min(
      state.anchor.rowWithinBlock,
      Math.max(0, recovered.rows - 1)
    );
    const requestedTop = Math.max(0, anchoredRow - state.anchor.viewportRow);
    offsetFromBottom = clampOffset(
      contentRows - viewportRows - requestedTop,
      contentRows,
      viewportRows
    );
  } else {
    offsetFromBottom = clampOffset(
      state.offsetFromBottom + contentRows - state.contentRows,
      contentRows,
      viewportRows
    );
  }
  if (offsetFromBottom === 0) {
    return {
      follow: true,
      offsetFromBottom: 0,
      unseenRows: 0,
      contentRows,
      viewportRows,
      blocks
    };
  }
  const nextTop = Math.max(0, contentRows - viewportRows - offsetFromBottom);
  const next = {
    follow: false,
    offsetFromBottom,
    unseenRows: state.unseenRows + Math.max(0, action.unseenRowsAdded ?? 0),
    contentRows,
    viewportRows,
    anchor: anchorForRow(nextTop, blocks, state.anchor?.viewportRow ?? 0),
    blocks
  };
  if (state.contentRows === next.contentRows && state.viewportRows === next.viewportRows && state.offsetFromBottom === next.offsetFromBottom && state.unseenRows === next.unseenRows && state.anchor?.blockId === next.anchor?.blockId && state.anchor?.rowWithinBlock === next.anchor?.rowWithinBlock && state.anchor?.viewportRow === next.anchor?.viewportRow && sameBlocks(state.blocks, next.blocks)) return state;
  return next;
}
function applyOffsetAndFollow(state, offsetFromBottom, follow) {
  if (offsetFromBottom === state.offsetFromBottom && follow === state.follow && (follow ? 0 : state.unseenRows) === state.unseenRows) {
    return state;
  }
  const nextTop = topRow({ ...state, offsetFromBottom });
  return {
    ...state,
    follow,
    offsetFromBottom,
    unseenRows: follow ? 0 : state.unseenRows,
    anchor: follow ? void 0 : anchorForRow(nextTop, state.blocks)
  };
}
function reduceTranscriptViewport(state, action) {
  switch (action.kind) {
    case "layout":
      return layoutState(state, action);
    case "scroll": {
      const available = maxOffset(state.contentRows, state.viewportRows);
      if (action.delta === 0) return state;
      if (available === 0) {
        return action.delta < 0 && !state.follow ? { ...state, follow: true, offsetFromBottom: 0, unseenRows: 0, anchor: void 0 } : state;
      }
      const offsetFromBottom = clampOffset(
        state.offsetFromBottom + action.delta,
        state.contentRows,
        state.viewportRows
      );
      const follow = offsetFromBottom === 0 ? true : action.delta > 0 ? false : state.follow;
      return applyOffsetAndFollow(state, offsetFromBottom, follow);
    }
    case "offset": {
      const offsetFromBottom = clampOffset(
        action.offsetFromBottom,
        state.contentRows,
        state.viewportRows
      );
      return applyOffsetAndFollow(state, offsetFromBottom, offsetFromBottom === 0);
    }
    case "position": {
      const available = maxOffset(state.contentRows, state.viewportRows);
      const fraction = Math.max(0, Math.min(action.fraction, 1));
      const offsetFromBottom = Math.round(available * (1 - fraction));
      return applyOffsetAndFollow(state, offsetFromBottom, offsetFromBottom === 0);
    }
    case "edge": {
      if (action.edge === "latest") {
        if (state.follow && state.offsetFromBottom === 0 && state.unseenRows === 0 && state.anchor === void 0) {
          return state;
        }
        return {
          ...state,
          follow: true,
          offsetFromBottom: 0,
          unseenRows: 0,
          anchor: void 0
        };
      }
      const offsetFromBottom = maxOffset(state.contentRows, state.viewportRows);
      if (!state.follow && state.offsetFromBottom === offsetFromBottom) {
        return state;
      }
      return {
        ...state,
        follow: false,
        offsetFromBottom,
        anchor: anchorForRow(0, state.blocks)
      };
    }
    case "reset": {
      if (state.follow && state.offsetFromBottom === 0 && state.unseenRows === 0 && state.contentRows === 0 && state.viewportRows === 0 && state.blocks.length === 0 && state.anchor === void 0) {
        return state;
      }
      return EMPTY_TRANSCRIPT_VIEWPORT;
    }
  }
}
function physicalScrollRailGeometry(contentRows, viewportRows, offsetFromBottom) {
  if (viewportRows <= 0 || contentRows <= viewportRows) return void 0;
  const rows = viewportRows;
  const thumbRows = Math.min(
    rows,
    Math.max(3, Math.floor(rows * viewportRows / contentRows))
  );
  const travel = rows - thumbRows;
  const available = contentRows - viewportRows;
  const fromBottom = Math.round(
    Math.max(0, Math.min(offsetFromBottom, available)) / available * travel
  );
  return { rows, thumbStart: travel - fromBottom, thumbRows };
}

// tui-render/src/transcript-layout-cache.ts
var TranscriptLayoutCache = class {
  scopeKey = "";
  measured = /* @__PURE__ */ new Map();
  ensureScope(scopeKey) {
    if (scopeKey === this.scopeKey) return;
    this.scopeKey = scopeKey;
    this.measured.clear();
  }
  /** Clear every retained measurement. */
  clear() {
    this.scopeKey = "";
    this.measured.clear();
  }
  /**
   * Build cumulative physical layouts from measured rows or estimates.
   * @param scopeKey - width/theme/fold identity shared by every input.
   * @param inputs - ordered stable block versions and initial estimates.
   * @returns ordered physical block layouts for the complete transcript.
   */
  layouts(scopeKey, inputs) {
    this.ensureScope(scopeKey);
    let top = 0;
    return inputs.map((input) => {
      const cached = this.measured.get(input.id);
      const rows = Math.max(
        1,
        cached?.version === input.version ? cached.rows : input.estimatedRows
      );
      const layout = { id: input.id, top, rows };
      top += rows;
      return layout;
    });
  }
  /**
   * Commit one rendered block's measured height.
   * @param scopeKey - width/theme/fold identity used by {@link layouts}.
   * @param id - stable block identity.
   * @param version - current block version.
   * @param rows - measured physical rows.
   * @returns whether the effective cached height changed.
   */
  record(scopeKey, id, version, rows) {
    this.ensureScope(scopeKey);
    const normalized = Math.max(1, rows);
    const current = this.measured.get(id);
    if (current?.version === version && current.rows === normalized) return false;
    this.measured.set(id, { version, rows: normalized });
    return true;
  }
};

// tui-render/src/mouse-io.ts
import { PassThrough } from "node:stream";

// tui-render/src/frame-metrics.ts
var FRAME_METRICS_CAPACITY = 120;
var PENDING_DELTA_INGRESS = /* @__PURE__ */ new WeakMap();
function markDeltaIngress(metrics, nowMs = performance.now()) {
  if (!PENDING_DELTA_INGRESS.has(metrics)) {
    PENDING_DELTA_INGRESS.set(metrics, nowMs);
  }
}
function completeDeltaStdoutDrain(metrics, nowMs = performance.now()) {
  const startedAt = PENDING_DELTA_INGRESS.get(metrics);
  if (startedAt === void 0) return;
  PENDING_DELTA_INGRESS.delete(metrics);
  metrics.recordDeltaIngressToStdoutDrain(Math.max(0, nowMs - startedAt));
}
function emptyCounter() {
  return { total: 0, windowCount: 0, windowSum: 0, windowMax: 0 };
}
function summarizeCounter(state) {
  return {
    total: state.total,
    windowCount: state.windowCount,
    windowSum: state.windowSum,
    windowMax: state.windowMax
  };
}
function addToCounter(state, n) {
  state.total += n;
  state.windowCount += 1;
  state.windowSum += n;
  if (n > state.windowMax) state.windowMax = n;
}
function resetCounterWindow(state) {
  state.windowCount = 0;
  state.windowSum = 0;
  state.windowMax = 0;
}
function createFrameMetrics(now = () => performance.now(), capacity = FRAME_METRICS_CAPACITY) {
  const startedAt = now();
  const frameIntervals = new DurationStats(capacity);
  let lastFrameAt;
  const drainSamples = new DurationStats(capacity);
  const scrollSamples = new DurationStats(capacity);
  const queueAgeSamples = new DurationStats(capacity);
  const counters = {
    inputEvents: emptyCounter(),
    coalescedInputs: emptyCounter(),
    markdownParseBytes: emptyCounter(),
    stableRowsReused: emptyCounter(),
    tailRowsRerendered: emptyCounter(),
    mountedRows: emptyCounter(),
    writtenCells: emptyCounter(),
    cacheBytes: emptyCounter(),
    cacheEvictions: emptyCounter()
  };
  const queueState = {
    currentDepth: 0,
    maxDepth: 0
  };
  return {
    recordFramePresented() {
      const current = now();
      if (lastFrameAt !== void 0) frameIntervals.record(Math.max(0, current - lastFrameAt));
      lastFrameAt = current;
    },
    recordInputEvent() {
      addToCounter(counters.inputEvents, 1);
    },
    recordCoalescedInput() {
      addToCounter(counters.coalescedInputs, 1);
    },
    recordDeltaIngressToStdoutDrain(ms) {
      drainSamples.record(ms);
    },
    addMarkdownParseBytes(n) {
      addToCounter(counters.markdownParseBytes, n);
    },
    addStableRowsReused(n) {
      addToCounter(counters.stableRowsReused, n);
    },
    addTailRowsRerendered(n) {
      addToCounter(counters.tailRowsRerendered, n);
    },
    addMountedRows(n) {
      addToCounter(counters.mountedRows, n);
    },
    addWrittenCells(n) {
      addToCounter(counters.writtenCells, n);
    },
    recordRenderQueue(depth, ageMs) {
      queueState.currentDepth = depth;
      if (depth > queueState.maxDepth) queueState.maxDepth = depth;
      queueAgeSamples.record(ageMs);
    },
    recordScrollInputToPaint(ms) {
      scrollSamples.record(ms);
    },
    addCacheBytes(n) {
      addToCounter(counters.cacheBytes, n);
    },
    addCacheEvictions(n) {
      addToCounter(counters.cacheEvictions, n);
    },
    resetWindow() {
      frameIntervals.resetWindow();
      resetCounterWindow(counters.inputEvents);
      resetCounterWindow(counters.coalescedInputs);
      resetCounterWindow(counters.markdownParseBytes);
      resetCounterWindow(counters.stableRowsReused);
      resetCounterWindow(counters.tailRowsRerendered);
      resetCounterWindow(counters.mountedRows);
      resetCounterWindow(counters.writtenCells);
      resetCounterWindow(counters.cacheBytes);
      resetCounterWindow(counters.cacheEvictions);
      queueState.maxDepth = queueState.currentDepth;
      drainSamples.resetWindow();
      scrollSamples.resetWindow();
      queueAgeSamples.resetWindow();
    },
    snapshot() {
      return {
        frameIntervalMs: frameIntervals.snapshot(),
        inputEvents: summarizeCounter(counters.inputEvents),
        coalescedInputs: summarizeCounter(counters.coalescedInputs),
        deltaIngressToStdoutDrainMs: drainSamples.snapshot(),
        markdownParseBytes: summarizeCounter(counters.markdownParseBytes),
        stableRowsReused: summarizeCounter(counters.stableRowsReused),
        tailRowsRerendered: summarizeCounter(counters.tailRowsRerendered),
        mountedRows: summarizeCounter(counters.mountedRows),
        writtenCells: summarizeCounter(counters.writtenCells),
        renderQueue: {
          currentDepth: queueState.currentDepth,
          maxDepth: queueState.maxDepth,
          ageMs: queueAgeSamples.snapshot()
        },
        scrollInputToPaintMs: scrollSamples.snapshot(),
        cacheBytes: summarizeCounter(counters.cacheBytes),
        cacheEvictions: summarizeCounter(counters.cacheEvictions),
        elapsedMs: now() - startedAt
      };
    },
    elapsedMs() {
      return now() - startedAt;
    }
  };
}

// tui-render/src/frame-snapshot.ts
var publishedSnapshot;
function setVisibleFrameSnapshot(snapshot) {
  publishedSnapshot = snapshot;
}
function visibleFrameSnapshot() {
  return publishedSnapshot;
}
var lineIdentityCache = /* @__PURE__ */ new WeakMap();
function physicalLineIdentity(line5) {
  let cached = lineIdentityCache.get(line5);
  if (cached !== void 0) return cached;
  cached = JSON.stringify([
    line5.text,
    line5.displayWidth,
    line5.background ?? "bg",
    line5.backgroundColumns ?? line5.displayWidth,
    line5.spans.map((span) => [
      span.text,
      span.token,
      span.bold === true ? 1 : 0,
      span.href ?? ""
    ])
  ]);
  lineIdentityCache.set(line5, cached);
  return cached;
}
function createFrameSnapshotRow(input) {
  return Object.freeze({
    ...input,
    identity: physicalLineIdentity(input.line)
  });
}
function sameGeometry(a, b) {
  if (a === b) return true;
  if (a.columns !== b.columns || a.rows !== b.rows || a.transcriptTop !== b.transcriptTop || a.transcriptLeft !== b.transcriptLeft || a.transcriptWidth !== b.transcriptWidth || a.transcriptRows !== b.transcriptRows) return false;
  const rA = a.rail;
  const rB = b.rail;
  if (rA === rB) return true;
  if (rA === void 0 || rB === void 0) return false;
  return rA.col === rB.col && rA.topRow === rB.topRow && rA.rows === rB.rows;
}
function screenRowKey(row) {
  return row.row << 16 | row.col;
}
function paintedColumns(line5) {
  return line5.backgroundColumns ?? line5.displayWidth;
}
function diffVisibleFrameSnapshots(previous, next) {
  const forced = previous === void 0 || !sameGeometry(previous.geometry, next.geometry);
  const oldRows = /* @__PURE__ */ new Map();
  if (previous !== void 0) {
    for (const row of previous.rows) {
      oldRows.set(screenRowKey(row), row);
    }
  }
  const changes = [];
  let unchangedRows = 0;
  for (const row of next.rows) {
    const key = screenRowKey(row);
    const old = oldRows.get(key);
    oldRows.delete(key);
    if (!forced && old !== void 0 && old.identity === row.identity) {
      unchangedRows += 1;
      continue;
    }
    changes.push({
      row: row.row,
      col: row.col,
      line: row.line,
      clearColumns: Math.max(
        old === void 0 ? 0 : paintedColumns(old.line),
        paintedColumns(row.line)
      )
    });
  }
  for (const old of oldRows.values()) {
    changes.push({
      row: old.row,
      col: old.col,
      line: void 0,
      clearColumns: paintedColumns(old.line)
    });
  }
  return { forced, changes, unchangedRows };
}

// tui-render/src/frame-fill.ts
var BG_OFF = "\x1B[49m";
var SGR_RESET = "\x1B[0m";
var ERASE_SCROLLBACK = "\x1B[3J";
var ENTER_ALTERNATE_SCREEN = "\x1B[?1049h";
var ERASE_DISPLAY = "\x1B[2J\x1B[H";
var END_SYNC = "\x1B[?2026l";
var START_SYNC = "\x1B[?2026h";
var SHOW_CURSOR = "\x1B[?25h";
var HIDE_CURSOR = "\x1B[?25l";
var WRITE_FRAME_OVERLAY = /* @__PURE__ */ Symbol("dsh.tui.write-frame-overlay");
var frameCaret;
var frameRail;
var paintedFrameRail;
var paintedVisibleFrame;
var paintedTranscriptRepaintKey;
function setFrameCaret(caret) {
  frameCaret = caret;
}
function hideFrameCaret() {
  frameCaret = "hide";
}
function setFrameRail(rail) {
  frameRail = rail;
}
function releaseFrameRail() {
  frameRail = void 0;
  paintedFrameRail = void 0;
}
function railCell(row, col, text, tier) {
  return `\x1B[${String(row)};${String(col)}H${text === " " ? styled(text, "bg", tier) : styled(styled(text, text === "\u2588" ? "accent" : "fgDim", tier), "bg", tier)}`;
}
function railRow(row, col, text, tier) {
  const guard = col > 1 ? railCell(row, col - 1, " ", tier) : "";
  return guard + railCell(row, col, text, tier);
}
function sameRail(a, b) {
  if (a === b) return true;
  if (a === void 0 || b === void 0) return false;
  return a.col === b.col && a.topRow === b.topRow && a.rows === b.rows && a.thumbStart === b.thumbStart && a.thumbRows === b.thumbRows;
}
function railOverlay(tier, force = false) {
  const next = frameRail;
  const previous = paintedFrameRail;
  if (!force && sameRail(previous, next)) return "";
  let cells = "";
  const geometry = visibleFrameSnapshot()?.geometry;
  const clearPreviousRow = (row, col) => {
    if (geometry !== void 0 && (col > geometry.columns || row < geometry.transcriptTop || row >= geometry.transcriptTop + geometry.transcriptRows || row > geometry.rows)) return "";
    return railRow(row, col, " ", tier);
  };
  if (previous !== void 0 && (next === void 0 || previous.col !== next.col)) {
    for (let index = 0; index < previous.rows; index += 1) {
      cells += clearPreviousRow(previous.topRow + index, previous.col);
    }
  } else if (previous !== void 0 && next !== void 0 && previous.col === next.col) {
    const nextStart = next.topRow;
    const nextEnd = next.topRow + next.rows;
    for (let index = 0; index < previous.rows; index += 1) {
      const row = previous.topRow + index;
      if (row < nextStart || row >= nextEnd) {
        cells += clearPreviousRow(row, previous.col);
      }
    }
  }
  if (next !== void 0) {
    for (let index = 0; index < next.rows; index += 1) {
      const thumb = index >= next.thumbStart && index < next.thumbStart + next.thumbRows;
      cells += railRow(next.topRow + index, next.col, thumb ? "\u2588" : "\xB7", tier);
    }
  }
  paintedFrameRail = next;
  return cells === "" ? "" : `\x1B7${cells}\x1B8`;
}
var paintedPhysicalLineCache = /* @__PURE__ */ new WeakMap();
function paintPhysicalLine(line5, tier) {
  const hyperlinks2 = hyperlinksEnabled();
  const cacheKey = `${tier}:${hyperlinks2 ? 1 : 0}`;
  let byTier = paintedPhysicalLineCache.get(line5);
  if (byTier === void 0) {
    byTier = /* @__PURE__ */ new Map();
    paintedPhysicalLineCache.set(line5, byTier);
  }
  const cached = byTier.get(cacheKey);
  if (cached !== void 0) return cached;
  const parts = line5.spans.map((span) => {
    const text = styled(span.text, span.token, tier, span.bold);
    return span.href !== void 0 && hyperlinks2 && isOsc8Href(span.href) ? wrapOsc8(text, span.href) : text;
  });
  const painted = line5.background !== void 0 && line5.background !== "bg" ? paintBackgroundRow(
    parts,
    line5.background,
    line5.backgroundColumns ?? Math.max(1, line5.displayWidth),
    tier
  ) : paintRow(parts, tier);
  byTier.set(cacheKey, painted);
  return painted;
}
var blankPadCache = /* @__PURE__ */ new Map();
function blankPad(count, tier) {
  if (count <= 0) return "";
  const key = `${tier}:${String(count)}`;
  let cached = blankPadCache.get(key);
  if (cached === void 0) {
    cached = styled(" ".repeat(count), "bg", tier);
    blankPadCache.set(key, cached);
  }
  return cached;
}
function transcriptOverlay(tier, synchronizedFrameEnded) {
  const next = visibleFrameSnapshot();
  if (next === void 0) {
    paintedVisibleFrame = void 0;
    paintedTranscriptRepaintKey = void 0;
    return "";
  }
  if (paintedVisibleFrame === next && (next.repaintKey === void 0 || next.repaintKey === paintedTranscriptRepaintKey)) {
    return "";
  }
  const diff = diffVisibleFrameSnapshots(paintedVisibleFrame, next);
  if (diff.forced && !synchronizedFrameEnded) return "";
  const repaintAll = synchronizedFrameEnded && (diff.forced || next.repaintKey !== void 0 && next.repaintKey !== paintedTranscriptRepaintKey);
  if (repaintAll) paintedTranscriptRepaintKey = next.repaintKey;
  paintedVisibleFrame = next;
  let cells = "";
  if (repaintAll) {
    const { columns, transcriptRows, transcriptTop } = next.geometry;
    const blank = blankPad(columns, tier);
    for (let index = 0; index < transcriptRows; index += 1) {
      cells += `\x1B[${String(transcriptTop + index)};1H${blank}`;
    }
    for (const row of next.rows) {
      cells += `\x1B[${String(row.row)};${String(row.col)}H` + paintPhysicalLine(row.line, tier);
    }
    return cells === "" ? "" : `\x1B7${cells}\x1B8`;
  }
  const railCol = next.geometry.rail?.col ?? next.geometry.columns;
  const guardCol = railCol > 1 ? railCol - 1 : railCol;
  for (const change of diff.changes) {
    const nextWidth = change.line === void 0 ? 0 : change.line.backgroundColumns ?? change.line.displayWidth;
    const targetColumns = Math.max(change.clearColumns, guardCol - change.col);
    const padColumns = targetColumns - nextWidth;
    if (change.line !== void 0) {
      cells += `\x1B[${String(change.row)};${String(change.col)}H` + paintPhysicalLine(change.line, tier);
    }
    if (padColumns > 0) {
      cells += `\x1B[${String(change.row)};${String(change.col + nextWidth)}H` + blankPad(padColumns, tier);
    }
  }
  return cells === "" ? "" : `\x1B7${cells}\x1B8`;
}
function caretSuffix() {
  if (frameCaret === void 0) return "";
  if (frameCaret === "hide") return HIDE_CURSOR;
  return `\x1B[${frameCaret.row};${frameCaret.col}H${SHOW_CURSOR}`;
}
function publishedCaretBytes() {
  return caretSuffix();
}
function writePublishedFrameRail(stdout, tier = currentTier()) {
  const overlay = railOverlay(tier, true);
  if (overlay === "") return;
  const bytes = START_SYNC + overlay + caretSuffix() + END_SYNC;
  const writer = stdout[WRITE_FRAME_OVERLAY];
  if (writer === void 0) {
    stdout.write(bytes);
    return;
  }
  writer(bytes);
}
function writePublishedFrameSnapshot(stdout, tier = currentTier()) {
  const transcript = transcriptOverlay(tier, true);
  const rail = railOverlay(tier, false);
  const overlay = transcript + rail;
  if (overlay === "") return;
  const bytes = START_SYNC + overlay + caretSuffix() + END_SYNC;
  const writer = stdout[WRITE_FRAME_OVERLAY];
  if (writer === void 0) {
    stdout.write(bytes);
    return;
  }
  writer(bytes);
}
function transformFrameChunk(chunk, tier = currentTier(), publishFrame = true) {
  let out = chunk;
  const on = bgSequence(tier);
  if (on !== "") {
    if (out.includes("\x1B")) {
      out = out.replaceAll(SGR_RESET, `${SGR_RESET}${on}`).replaceAll(BG_OFF, `${BG_OFF}${on}`).replaceAll(
        ERASE_SCROLLBACK,
        `${BG_OFF}${ERASE_SCROLLBACK}${on}`
      );
    }
    if (out.includes(ENTER_ALTERNATE_SCREEN)) {
      out = out.replaceAll(
        ENTER_ALTERNATE_SCREEN,
        `${ENTER_ALTERNATE_SCREEN}${on}${ERASE_DISPLAY}`
      );
    }
    out = `${on}${out}${BG_OFF}`;
  }
  const isFrame = out.includes(END_SYNC) || out.includes(SHOW_CURSOR) || out.includes(HIDE_CURSOR);
  if (isFrame && publishFrame) {
    const overlay = transcriptOverlay(tier, out.includes(END_SYNC)) + railOverlay(tier, true) + caretSuffix();
    const syncIndex = out.lastIndexOf(END_SYNC);
    out = syncIndex < 0 ? out + overlay : out.slice(0, syncIndex) + overlay + out.slice(syncIndex);
  }
  return out;
}
function wrapStdoutForFrameBg(stdout, getTier = currentTier, frameMetrics) {
  const write = stdout.write.bind(stdout);
  const wrapped = Object.create(stdout);
  let synchronizedFrameOpen = false;
  let inkBottomRow = stdout.rows;
  const transformingWrite = (chunk, ...args) => {
    if (typeof chunk === "string" && chunk.includes(START_SYNC)) synchronizedFrameOpen = true;
    if (typeof chunk === "string" && chunk.includes(END_SYNC)) synchronizedFrameOpen = false;
    const inkChunk = typeof chunk === "string" && stdout.isTTY && frameCaret !== void 0 && /\x1b\[\d*A|\x1b\[2K/u.test(chunk) ? `\x1B[${Math.min(inkBottomRow, stdout.rows)};1H${chunk}` : chunk;
    const transformed = typeof inkChunk === "string" ? transformFrameChunk(inkChunk, getTier(), !synchronizedFrameOpen) : inkChunk;
    if (typeof chunk === "string" && chunk.includes("\n")) inkBottomRow = Math.min(stdout.rows, chunk.split("\n").length);
    return writeMeasured(transformed, ...args);
  };
  const writeMeasured = (transformed, ...args) => {
    if (frameMetrics !== void 0 && typeof transformed === "string") {
      frameMetrics.addWrittenCells(countWrittenCells(transformed));
      const last = args.at(-1);
      const onDrain = () => {
        completeDeltaStdoutDrain(frameMetrics);
        if (transformed.includes(END_SYNC)) frameMetrics.recordFramePresented();
      };
      if (typeof last === "function") {
        const original = last;
        args[args.length - 1] = (...callbackArgs) => {
          onDrain();
          original(...callbackArgs);
        };
      } else {
        args.push(onDrain);
      }
    }
    return write(transformed, ...args);
  };
  wrapped.write = transformingWrite;
  const overlayStream = wrapped;
  overlayStream[WRITE_FRAME_OVERLAY] = (chunk) => writeMeasured(chunk);
  return wrapped;
}
var TERMINAL_CONTROL_PATTERN = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b./gu;
function countWrittenCells(chunk) {
  const printable = chunk.replace(TERMINAL_CONTROL_PATTERN, (control) => control.startsWith("\x1B]") || control.startsWith("\x1B[") && control.endsWith("m") ? "" : "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, "");
  return printable.split("\n").reduce((cells, line5) => cells + displayWidth(line5), 0);
}

// tui-render/src/screen-atlas.ts
var GRAPHEME2 = new Intl.Segmenter(void 0, { granularity: "grapheme" });
function paintSnapshotLine(line5) {
  const parts = line5.spans.map((span) => {
    const painted = styled(span.text, span.token, void 0, span.bold);
    const href = span.href ?? line5.osc8?.href;
    return href === void 0 || !hyperlinksEnabled() ? painted : wrapOsc8(painted, href);
  });
  return line5.background !== void 0 && line5.background !== "bg" ? paintBackgroundRow(
    parts,
    line5.background,
    line5.backgroundColumns ?? Math.max(1, line5.displayWidth)
  ) : paintRow(parts);
}
function orderedPoints(a, b) {
  if (a.row < b.row || a.row === b.row && a.col <= b.col) {
    return { start: a, end: b };
  }
  return { start: b, end: a };
}
var ScreenAtlas = class {
  /** Column count. */
  width;
  /** Row count. */
  height;
  cells;
  cursorCol = 0;
  cursorRow = 0;
  showsCursor = true;
  savedCursorCol = 0;
  savedCursorRow = 0;
  wrapPending = false;
  activeUrl;
  leftover = "";
  snapshotRanges = [];
  snapshotRows = /* @__PURE__ */ new Map();
  snapshotRail;
  /**
   * @param width - terminal columns.
   * @param height - terminal rows.
   */
  constructor(width = 80, height = 24) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.cells = this.blank();
  }
  /**
   * Position reached by the consumed terminal bytes, independent of layout estimates.
   * @returns a fresh one-based cursor coordinate.
   */
  get cursorPosition() {
    return { col: this.cursorCol + 1, row: this.cursorRow + 1 };
  }
  /**
   * Visibility selected by the most recent DEC cursor visibility control.
   * @returns true before any visibility control or after showing the cursor.
   */
  get cursorVisible() {
    return this.showsCursor;
  }
  /**
   * Resize the grid, preserving overlapping cells.
   * @param width - next columns.
   * @param height - next rows.
   */
  resize(width, height) {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    if (nextWidth === this.width && nextHeight === this.height) return;
    const next = new Array(nextWidth * nextHeight);
    for (let row = 0; row < nextHeight; row++) {
      for (let col = 0; col < nextWidth; col++) {
        const previous = row < this.height && col < this.width ? this.cells[row * this.width + col] : void 0;
        next[row * nextWidth + col] = previous ?? {
          ch: " ",
          url: void 0,
          written: false
        };
      }
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.cells = next;
    this.cursorCol = Math.min(this.cursorCol, this.width - 1);
    this.cursorRow = Math.min(this.cursorRow, this.height - 1);
    this.savedCursorCol = Math.min(this.savedCursorCol, this.width - 1);
    this.savedCursorRow = Math.min(this.savedCursorRow, this.height - 1);
    this.wrapPending = false;
    this.snapshotRows.clear();
    this.snapshotRail = void 0;
  }
  /**
   * Consume one stdout chunk, holding incomplete ESC prefixes.
   * @param chunk - bytes written to the terminal.
   */
  feed(chunk) {
    this.snapshotRows.clear();
    this.snapshotRail = void 0;
    const text = this.leftover + chunk;
    this.leftover = "";
    const segments = GRAPHEME2.segment(text)[Symbol.iterator]();
    let segment2 = segments.next();
    let index = 0;
    while (index < text.length) {
      if (text.startsWith("\x1B]8;", index)) {
        const parsed = readOsc8(text, index);
        if (parsed === void 0) {
          this.leftover = text.slice(index);
          return;
        }
        this.activeUrl = parsed.url;
        index = parsed.end;
        continue;
      }
      if (text[index] === "\x1B") {
        if (index + 1 === text.length) {
          this.leftover = text.slice(index);
          return;
        }
        if (text[index + 1] === "[") {
          const csi = readCsi(text, index);
          if (csi === void 0) {
            this.leftover = text.slice(index);
            return;
          }
          if (text.startsWith("\x1B[?", index) && csi.params.includes(25) && (csi.final === "h" || csi.final === "l")) {
            this.showsCursor = csi.final === "h";
          }
          this.applyCsi(csi.params, csi.final);
          index = csi.end;
          continue;
        }
        if (text[index + 1] === "]") {
          const osc = readOscGeneric(text, index);
          if (osc === void 0) {
            this.leftover = text.slice(index);
            return;
          }
          index = osc;
          continue;
        }
        if (text[index + 1] === "7") {
          this.savedCursorCol = this.cursorCol;
          this.savedCursorRow = this.cursorRow;
        } else if (text[index + 1] === "8") {
          this.cursorCol = this.savedCursorCol;
          this.cursorRow = this.savedCursorRow;
          this.wrapPending = false;
        }
        index += 2;
        continue;
      }
      if (text[index] === "\r") {
        this.cursorCol = 0;
        this.wrapPending = false;
        index += 1;
        continue;
      }
      if (text[index] === "\n") {
        this.advanceRow();
        this.cursorCol = 0;
        this.wrapPending = false;
        index += 1;
        continue;
      }
      if (text[index] === "\b") {
        this.wrapPending = false;
        this.cursorCol = Math.max(0, this.cursorCol - 1);
        index += 1;
        continue;
      }
      while (!segment2.done && segment2.value.index < index) {
        segment2 = segments.next();
      }
      const grapheme = !segment2.done && segment2.value.index === index ? segment2.value.segment : text[index];
      this.writeGrapheme(grapheme);
      index += grapheme.length;
    }
  }
  /**
   * Apply renderer-owned transcript rows directly. This is the normal product
   * geometry path. Unchanged rows retain their cells and source links;
   * changed rail geometry invalidates reuse. {@link feed} remains the fallback for external bytes and
   * shells that do not publish physical rows.
   * @param snapshot - shared visible frame from the transcript renderer.
   */
  applyFrameSnapshot(snapshot) {
    const previousRail = this.snapshotRail;
    const nextRail = snapshot.geometry.rail;
    const sameRailArea = previousRail?.col === nextRail?.col && previousRail?.topRow === nextRail?.topRow && previousRail?.rows === nextRail?.rows;
    const unchanged = /* @__PURE__ */ new Set();
    if (sameRailArea) for (const row of snapshot.rows) {
      const previous = this.snapshotRows.get(row.row);
      if (previous?.line === row.line && previous.col === row.col) unchanged.add(row.row);
    }
    if (!sameRailArea && previousRail !== void 0) {
      for (let index = 0; index < previousRail.rows; index += 1) {
        const row = previousRail.topRow - 1 + index;
        for (const col of [previousRail.col - 2, previousRail.col - 1]) {
          if (col >= 0 && col < this.width && row >= 0 && row < this.height) {
            this.cells[row * this.width + col] = { ch: " ", url: void 0, written: false };
          }
        }
      }
    }
    for (const range of this.snapshotRanges) {
      if (unchanged.has(range.row)) continue;
      for (let offset = 0; offset < range.width; offset += 1) {
        const col = range.col - 1 + offset;
        const row = range.row - 1;
        if (col < 0 || col >= this.width || row < 0 || row >= this.height) continue;
        this.cells[row * this.width + col] = {
          ch: " ",
          url: void 0,
          written: false
        };
      }
    }
    this.snapshotRanges = [];
    this.snapshotRows.clear();
    this.snapshotRail = snapshot.geometry.rail;
    const saved = {
      col: this.cursorCol,
      row: this.cursorRow,
      url: this.activeUrl,
      wrap: this.wrapPending
    };
    for (const row of snapshot.rows) {
      this.snapshotRows.set(row.row, row);
      if (!unchanged.has(row.row)) {
        this.cursorCol = Math.max(0, row.col - 1);
        this.cursorRow = Math.max(0, row.row - 1);
        this.wrapPending = false;
        for (const span of row.line.spans) {
          this.activeUrl = span.href;
          for (const part of GRAPHEME2.segment(span.text)) this.writeGrapheme(part.segment);
        }
      }
      this.snapshotRanges.push({
        row: row.row,
        col: row.col,
        width: row.line.displayWidth
      });
    }
    const rail = snapshot.geometry.rail;
    if (rail !== void 0) {
      for (let index = 0; index < rail.rows; index += 1) {
        const col = rail.col - 1;
        const row = rail.topRow - 1 + index;
        if (col < 0 || col >= this.width || row < 0 || row >= this.height) continue;
        if (col > 0) {
          this.cells[row * this.width + col - 1] = {
            ch: " ",
            url: void 0,
            written: false
          };
        }
        const thumb = index >= rail.thumbStart && index < rail.thumbStart + rail.thumbRows;
        this.cells[row * this.width + col] = {
          ch: thumb ? "\u2588" : "\xB7",
          url: void 0,
          written: true
        };
      }
    }
    this.cursorCol = saved.col;
    this.cursorRow = saved.row;
    this.activeUrl = saved.url;
    this.wrapPending = saved.wrap;
  }
  /**
   * OSC 8 href at a 1-based SGR coordinate.
   * @param col - 1-based column.
   * @param row - 1-based row.
   * @returns the href, or undefined.
   */
  urlAt(col, row) {
    return this.cellAt(col, row)?.url;
  }
  /**
   * Cell at a 1-based SGR coordinate.
   * @param col - 1-based column.
   * @param row - 1-based row.
   * @returns the cell, or undefined when out of range.
   */
  cellAt(col, row) {
    if (col < 1 || row < 1 || col > this.width || row > this.height) {
      return void 0;
    }
    return this.cells[(row - 1) * this.width + (col - 1)];
  }
  /**
   * Reading-order plain text between two inclusive endpoints. Published rail
   * cells are excluded, trailing spaces are trimmed, and rows join with `\n`.
   * @param a - one endpoint.
   * @param b - the other endpoint.
   * @returns selected text.
   */
  extract(a, b) {
    const { start, end } = orderedPoints(a, b);
    const lines = [];
    for (let row = start.row; row <= end.row; row++) {
      const from = row === start.row ? start.col : 1;
      const to = row === end.row ? end.col : this.width;
      let line5 = "";
      for (let col = from; col <= to; col++) {
        if (this.isSnapshotRailControlCell(col, row)) continue;
        const cell = this.cellAt(col, row);
        if (cell === void 0 || cell.ch === "") continue;
        line5 += cell.ch;
      }
      lines.push(line5.replace(/ +$/u, ""));
    }
    return lines.join("\n");
  }
  collectRowTextRuns(row, from, to, onRun) {
    let run = "";
    let runCol = 0;
    const flush = () => {
      if (run === "" || runCol === 0) return;
      onRun(runCol, run);
      run = "";
      runCol = 0;
    };
    for (let col = from; col <= to; col++) {
      if (this.isSnapshotRailControlCell(col, row)) {
        flush();
        continue;
      }
      const cell = this.cellAt(col, row);
      if (cell === void 0 || !cell.written || cell.ch === "") {
        flush();
        continue;
      }
      if (run === "") runCol = col;
      run += cell.ch;
    }
    flush();
  }
  /**
   * Iterate over screen rows within a selection range, calculating the column span.
   * @param a - one endpoint.
   * @param b - the other endpoint.
   * @param callback - visitor receiving row index and column bounds [from, to].
   */
  forEachRowInRange(a, b, callback) {
    const { start, end } = orderedPoints(a, b);
    for (let row = start.row; row <= end.row; row++) {
      const from = row === start.row ? start.col : 1;
      const to = row === end.row ? end.col : this.width;
      callback(row, from, to);
    }
  }
  /**
   * Reverse-video overlay that rewrites selectable cells. Published rail cells
   * are excluded. Empty when the range has no glyphs.
   * @param a - one endpoint.
   * @param b - the other endpoint.
   * @returns CUP + reverse SGR bytes.
   */
  selectionOverlay(a, b) {
    let out = "";
    this.forEachRowInRange(a, b, (row, from, to) => {
      this.collectRowTextRuns(row, from, to, (runCol, run) => {
        out += `\x1B[${row};${runCol}H\x1B[7m${run}\x1B[27m`;
      });
    });
    return out;
  }
  /**
   * Repaint the written cells in a former selection with the normal page
   * foreground/background so reverse-video cells do not survive a range
   * change or release.
   * @param a - one endpoint.
   * @param b - the other endpoint.
   * @returns CUP + normal painted runs for the occupied cells.
   */
  restoreOverlay(a, b) {
    let out = "";
    this.forEachRowInRange(a, b, (row, from, to) => {
      const snapshotRow = this.snapshotRows.get(row);
      if (snapshotRow !== void 0 && !this.snapshotRowOverlapsRailControl(snapshotRow) && from <= snapshotRow.col + snapshotRow.line.displayWidth - 1 && to >= snapshotRow.col) {
        out += `\x1B[${row};${snapshotRow.col}H${paintSnapshotLine(snapshotRow.line)}`;
        return;
      }
      this.collectRowTextRuns(row, from, to, (runCol, run) => {
        out += `\x1B[${row};${runCol}H${paintRow([styled(run, "fg")])}`;
      });
    });
    return out;
  }
  blank() {
    return Array.from({ length: this.width * this.height }, () => ({
      ch: " ",
      url: void 0,
      written: false
    }));
  }
  isSnapshotRailControlCell(col, row) {
    const rail = this.snapshotRail;
    return rail !== void 0 && col >= Math.max(1, rail.col - 1) && col <= rail.col && row >= rail.topRow && row < rail.topRow + rail.rows;
  }
  snapshotRowOverlapsRailControl(row) {
    const rail = this.snapshotRail;
    return rail !== void 0 && row.row >= rail.topRow && row.row < rail.topRow + rail.rows && row.col + (row.line.backgroundColumns ?? row.line.displayWidth) - 1 >= Math.max(1, rail.col - 1);
  }
  writeGrapheme(grapheme) {
    if (grapheme < " " && grapheme !== "	") return;
    const width = Math.max(1, displayWidth(grapheme === "	" ? " " : grapheme));
    if (this.wrapPending || this.cursorCol + width > this.width) {
      this.cursorCol = 0;
      this.advanceRow();
      this.wrapPending = false;
    }
    this.put(this.cursorCol, this.cursorRow, {
      ch: grapheme === "	" ? " " : grapheme,
      url: this.activeUrl,
      written: true
    });
    for (let extra = 1; extra < width; extra++) {
      this.put(this.cursorCol + extra, this.cursorRow, {
        ch: "",
        url: this.activeUrl,
        written: true
      });
    }
    const nextCol = this.cursorCol + width;
    this.wrapPending = nextCol >= this.width;
    this.cursorCol = this.wrapPending ? this.width - 1 : nextCol;
  }
  put(col, row, cell) {
    if (col < 0 || row < 0 || col >= this.width || row >= this.height) return;
    this.cells[row * this.width + col] = cell;
  }
  advanceRow() {
    if (this.cursorRow + 1 < this.height) this.cursorRow += 1;
  }
  applyCsi(params, final) {
    this.wrapPending = false;
    const first = params[0] ?? 0;
    const second = params[1] ?? 0;
    if (final === "H" || final === "f") {
      this.cursorRow = Math.max(0, (first === 0 ? 1 : first) - 1);
      this.cursorCol = Math.max(0, (second === 0 ? 1 : second) - 1);
      this.cursorRow = Math.min(this.cursorRow, this.height - 1);
      this.cursorCol = Math.min(this.cursorCol, this.width - 1);
      return;
    }
    if (final === "A") {
      this.cursorRow = Math.max(0, this.cursorRow - Math.max(1, first || 1));
      return;
    }
    if (final === "B") {
      this.cursorRow = Math.min(
        this.height - 1,
        this.cursorRow + Math.max(1, first || 1)
      );
      return;
    }
    if (final === "C") {
      this.cursorCol = Math.min(
        this.width - 1,
        this.cursorCol + Math.max(1, first || 1)
      );
      return;
    }
    if (final === "D") {
      this.cursorCol = Math.max(0, this.cursorCol - Math.max(1, first || 1));
      return;
    }
    if (final === "G") {
      this.cursorCol = Math.min(
        this.width - 1,
        Math.max(0, (first === 0 ? 1 : first) - 1)
      );
      return;
    }
    if (final === "J") {
      if (first === 2 || first === 3) {
        this.cells = this.blank();
        this.cursorCol = 0;
        this.cursorRow = 0;
      }
      return;
    }
    if (final === "K") {
      const row = this.cursorRow;
      const start = first === 1 || first === 2 ? 0 : this.cursorCol;
      const end = first === 1 ? this.cursorCol + 1 : this.width;
      for (let col = start; col < end; col++) {
        this.put(col, row, { ch: " ", url: void 0, written: false });
      }
    }
  }
};
function readOsc8(text, start) {
  const payloadStart = start + "\x1B]8;".length;
  const st = text.indexOf("\x1B\\", payloadStart);
  const bel = text.indexOf("\x07", payloadStart);
  const terminatedByBel = bel >= 0 && (st < 0 || bel < st);
  const payloadEnd = terminatedByBel ? bel : st;
  if (payloadEnd < 0) return void 0;
  const end = terminatedByBel ? payloadEnd + 1 : payloadEnd + 2;
  const payload = text.slice(payloadStart, payloadEnd);
  const sep = payload.indexOf(";");
  const url = sep >= 0 ? payload.slice(sep + 1) : "";
  return { url: url === "" ? void 0 : url, end };
}
function readOscGeneric(text, start) {
  const payloadStart = start + 2;
  const st = text.indexOf("\x1B\\", payloadStart);
  const bel = text.indexOf("\x07", payloadStart);
  if (st >= 0 && (bel < 0 || st < bel)) return st + 2;
  if (bel >= 0) return bel + 1;
  return void 0;
}
function readCsi(text, start) {
  let index = start + 2;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 64 && code <= 126) {
      const body = text.slice(start + 2, index);
      const numeric = body.replace(/[^\d;]/g, "");
      const params = numeric === "" ? [] : numeric.split(";").map((part) => part === "" ? 0 : Number(part));
      return { params, final: text[index], end: index + 1 };
    }
    index += 1;
  }
  return void 0;
}

// tui-render/src/sgr-mouse.ts
var ENABLE_SGR_MOUSE = "\x1B[?1000h\x1B[?1002h\x1B[?1006h";
var DISABLE_SGR_MOUSE = "\x1B[?1006l\x1B[?1002l\x1B[?1000l";
var COMPLETE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
var INCOMPLETE = /^\x1b\[<(?:\d+)?(?:;\d*){0,2}$/;
function decodeSgrMouse(button, col, row, suffix) {
  if (button === 64) {
    return { kind: "wheel", button: "none", col, row, delta: 1 };
  }
  if (button === 65) {
    return { kind: "wheel", button: "none", col, row, delta: -1 };
  }
  if (button === 66 || button === 67) return void 0;
  const base = button & 3;
  const motion = (button & 32) !== 0;
  const decoded = base === 0 ? "left" : base === 1 ? "middle" : base === 2 ? "right" : "none";
  if (suffix === "m") {
    return { kind: "release", button: decoded, col, row };
  }
  if (motion) return { kind: "drag", button: decoded, col, row };
  return { kind: "press", button: decoded, col, row };
}
function consumeMouseStdin(buffer) {
  const mouse = [];
  let forward = "";
  let index = 0;
  while (index < buffer.length) {
    const remaining = buffer.slice(index);
    if (!remaining.startsWith("\x1B")) {
      forward += remaining.charAt(0);
      index += 1;
      continue;
    }
    if (remaining === "\x1B" || remaining === "\x1B[") {
      return { mouse, forward, rest: remaining };
    }
    if (remaining.startsWith("\x1B[<")) {
      const match = COMPLETE.exec(remaining);
      if (match !== null) {
        const event = decodeSgrMouse(
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
          match[4]
        );
        if (event !== void 0) mouse.push(event);
        index += match[0].length;
        continue;
      }
      if (INCOMPLETE.test(remaining)) {
        return { mouse, forward, rest: remaining };
      }
      forward += remaining.charAt(0);
      index += 1;
      continue;
    }
    forward += remaining.charAt(0);
    index += 1;
  }
  return { mouse, forward, rest: "" };
}

// tui-render/src/clipboard.ts
import { spawn } from "node:child_process";
var OSC52_MAX_CHARS = 1e5;
function encodeOsc52(text) {
  const capped = text.length > OSC52_MAX_CHARS ? text.slice(0, OSC52_MAX_CHARS) : text;
  return `\x1B]52;c;${Buffer.from(capped, "utf8").toString("base64")}\x1B\\`;
}
function hostClipboardCommand(platform = process.platform, env = process.env) {
  if (platform === "darwin") return { command: "pbcopy", args: [] };
  if (platform === "win32") return { command: "clip", args: [] };
  if (env.WAYLAND_DISPLAY !== void 0) return { command: "wl-copy", args: [] };
  if (env.DISPLAY !== void 0) {
    return { command: "xclip", args: ["-selection", "clipboard"] };
  }
  return void 0;
}
function copyText(text, write, spawnFn = spawn, spec) {
  if (text === "") return;
  write(encodeOsc52(text));
  const helper = spec === void 0 ? hostClipboardCommand() : spec === null ? void 0 : spec;
  if (helper === void 0) return;
  try {
    const child = spawnFn(helper.command, helper.args, {
      stdio: ["pipe", "ignore", "ignore"]
    });
    child.on("error", () => {
    });
    child.stdin?.end(text);
  } catch {
  }
}

// tui-render/src/open-url.ts
import { spawn as spawn2 } from "node:child_process";
function openerSpec(platform, href) {
  if (platform === "darwin") return { command: "open", args: [href] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", href] };
  return { command: "xdg-open", args: [href] };
}
function openUrl(href, spawnFn = spawn2, platform = process.platform) {
  if (!isOsc8Href(href)) return;
  const spec = openerSpec(platform, href);
  try {
    const child = spawnFn(spec.command, spec.args, {
      detached: true,
      stdio: "ignore"
    });
    child.on("error", () => {
    });
    child.unref();
  } catch {
  }
}

// tui-render/src/mouse-io.ts
var scrollListener;
var railListener;
var railRegion;
function setMouseScrollListener(listener) {
  scrollListener = listener;
}
function notifyMouseScroll(delta) {
  scrollListener?.(delta);
}
function setMouseRailListener(listener) {
  railListener = listener;
}
function setMouseRailRegion(region) {
  railRegion = region;
}
function railFraction(region, row) {
  if (region.rows <= 1) return 1;
  return Math.max(0, Math.min((row - region.topRow) / (region.rows - 1), 1));
}
function hitRail(col, row) {
  const region = railRegion;
  if (region === void 0 || col !== region.col) return void 0;
  return row >= region.topRow && row < region.topRow + region.rows ? region : void 0;
}
var MouseSession = class {
  /** Cell atlas of bytes written through {@link feedStdout}. */
  atlas;
  lastFrameRevision;
  drag;
  selection;
  paintedSelection;
  railDrag;
  edgeTimer;
  openHref;
  copy;
  onScroll;
  onRail;
  startInterval;
  stopInterval;
  /**
   * @param options - grid size and I/O hooks.
   */
  constructor(options = {}) {
    this.atlas = new ScreenAtlas(options.columns ?? 80, options.rows ?? 24);
    this.openHref = options.openUrl ?? openUrl;
    this.copy = options.copyText ?? ((_text) => {
    });
    this.onScroll = options.onScroll ?? notifyMouseScroll;
    this.onRail = options.onRail ?? ((fraction) => railListener?.(fraction));
    this.startInterval = options.setInterval ?? setInterval;
    this.stopInterval = options.clearInterval ?? clearInterval;
  }
  /**
   * Consume a decoded mouse event and return any immediate selection repaint.
   * @param event - SGR report.
   * @returns terminal bytes that update or clear the visible selection.
   */
  handle(event) {
    if (event.kind === "wheel" && event.delta !== void 0) {
      this.onScroll(event.delta);
      return "";
    }
    const point = { col: event.col, row: event.row };
    if (event.kind === "press" && event.button === "left") {
      this.stopEdge();
      const region = hitRail(event.col, event.row);
      if (region !== void 0) {
        this.railDrag = region;
        this.drag = void 0;
        this.selection = void 0;
        this.onRail(railFraction(region, event.row));
        return this.repaintSelection();
      }
      this.drag = { start: point, moved: false };
      this.selection = { start: point, end: point };
      return "";
    }
    if (event.kind === "drag" && this.railDrag !== void 0 && event.button === "left") {
      this.onRail(railFraction(this.railDrag, event.row));
      return "";
    }
    if (event.kind === "release" && this.railDrag !== void 0) {
      this.onRail(railFraction(this.railDrag, event.row));
      this.railDrag = void 0;
      return "";
    }
    if (event.kind === "drag" && this.drag !== void 0 && event.button === "left") {
      if (event.col !== this.drag.start.col || event.row !== this.drag.start.row) {
        this.drag.moved = true;
      }
      this.selection = { start: this.drag.start, end: point };
      this.syncEdge(event.row);
      return this.repaintSelection();
    }
    if (event.kind === "release" && this.drag !== void 0) {
      this.stopEdge();
      if (event.col !== this.drag.start.col || event.row !== this.drag.start.row) {
        this.drag.moved = true;
        this.selection = { start: this.drag.start, end: point };
      }
      if (this.drag.moved) {
        const range = this.selection;
        this.copy(this.atlas.extract(range.start, range.end));
      } else {
        const href = this.atlas.urlAt(event.col, event.row);
        if (href !== void 0) this.openHref(href);
      }
      this.drag = void 0;
      this.selection = void 0;
      return this.repaintSelection();
    }
    return "";
  }
  /**
   * Feed a stdout chunk through the atlas and append a selection overlay.
   * @param chunk - bytes about to hit the terminal.
   * @returns chunk plus overlay and caret restore.
   */
  feedStdout(chunk) {
    const snapshot = visibleFrameSnapshot();
    if (snapshot === void 0) {
      this.atlas.feed(chunk);
    } else if (snapshot.revision !== this.lastFrameRevision) {
      this.atlas.applyFrameSnapshot(snapshot);
      this.lastFrameRevision = snapshot.revision;
    }
    if (this.selection === void 0) return chunk;
    const overlay = this.atlas.selectionOverlay(
      this.selection.start,
      this.selection.end
    );
    if (overlay === "") return chunk;
    this.paintedSelection = this.selection;
    return `${chunk}${overlay}${publishedCaretBytes()}`;
  }
  /**
   * Resize the atlas to the live terminal size.
   * @param columns - next width.
   * @param rows - next height.
   */
  resize(columns, rows) {
    this.atlas.resize(columns, rows);
  }
  /** Clear timers. */
  dispose() {
    this.stopEdge();
    this.railDrag = void 0;
  }
  syncEdge(row) {
    const top = row <= 2;
    const bottom = row >= this.atlas.height - 1;
    if (!top && !bottom) {
      this.stopEdge();
      return;
    }
    const delta = top ? 1 : -1;
    if (this.edgeTimer !== void 0) return;
    this.onScroll(delta);
    this.edgeTimer = this.startInterval(() => {
      this.onScroll(delta);
    }, 80);
  }
  stopEdge() {
    if (this.edgeTimer === void 0) return;
    this.stopInterval(this.edgeTimer);
    this.edgeTimer = void 0;
  }
  repaintSelection() {
    let bytes = "";
    if (this.paintedSelection !== void 0) {
      bytes += this.atlas.restoreOverlay(
        this.paintedSelection.start,
        this.paintedSelection.end
      );
    }
    if (this.selection !== void 0 && this.drag?.moved === true) {
      bytes += this.atlas.selectionOverlay(
        this.selection.start,
        this.selection.end
      );
      this.paintedSelection = this.selection;
    } else {
      this.paintedSelection = void 0;
    }
    return bytes === "" ? "" : bytes + publishedCaretBytes();
  }
};
function attachMouseIo(options) {
  const session = options.session ?? new MouseSession({
    columns: options.stdout.columns,
    rows: options.stdout.rows,
    copyText: (text) => {
      copyText(text, (chunk) => {
        options.stdout.write(chunk);
      });
    },
    onScroll: notifyMouseScroll
  });
  const tty = options.stdin.isTTY && options.stdout.isTTY;
  if (!tty) {
    return {
      stdin: options.stdin,
      stdout: options.stdout,
      session,
      dispose: () => {
        session.dispose();
      }
    };
  }
  const write = options.stdout.write.bind(options.stdout);
  options.stdout.write(ENABLE_SGR_MOUSE);
  const wrappedStdin = wrapStdin(options.stdin, (event) => {
    const repaint = session.handle(event);
    if (repaint !== "") write(repaint);
  }, options.wheelRows ?? RENDER_POLICY_DEFAULT_SCROLL_WHEEL_ROWS);
  const wrappedStdout = Object.create(options.stdout);
  const transformingWrite = (chunk, ...args) => {
    if (typeof chunk !== "string") return write(chunk, ...args);
    return write(session.feedStdout(chunk), ...args);
  };
  wrappedStdout.write = transformingWrite;
  const onResize = () => {
    session.resize(options.stdout.columns, options.stdout.rows);
  };
  options.stdout.on("resize", onResize);
  return {
    stdin: wrappedStdin.stdin,
    stdout: wrappedStdout,
    session,
    dispose: () => {
      options.stdout.off("resize", onResize);
      wrappedStdin.dispose();
      session.dispose();
      options.stdout.write(DISABLE_SGR_MOUSE);
    }
  };
}
function wrapStdin(raw, onMouse, wheelRows) {
  const stream = new PassThrough();
  stream.isTTY = true;
  stream.setRawMode = (mode) => {
    if (typeof raw.setRawMode === "function") raw.setRawMode(mode);
    return stream;
  };
  stream.ref = () => {
    if (typeof raw.ref === "function") raw.ref();
    return stream;
  };
  stream.unref = () => {
    if (typeof raw.unref === "function") raw.unref();
    return stream;
  };
  let buffer = "";
  let flushTimer;
  const onData = (chunk) => {
    if (flushTimer !== void 0) {
      clearTimeout(flushTimer);
      flushTimer = void 0;
    }
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const consumed = consumeMouseStdin(buffer);
    buffer = consumed.rest;
    let wheelDelta = 0;
    let wheelEvent;
    const flushWheel = () => {
      if (wheelDelta === 0 || wheelEvent === void 0) return;
      onMouse({ ...wheelEvent, delta: wheelDelta * wheelRows });
      wheelDelta = 0;
      wheelEvent = void 0;
    };
    for (const event of consumed.mouse) {
      if (event.kind === "wheel" && event.delta !== void 0) {
        wheelDelta += event.delta;
        wheelEvent = event;
        continue;
      }
      flushWheel();
      onMouse(event);
    }
    flushWheel();
    if (consumed.forward !== "") stream.write(consumed.forward);
    if (buffer !== "") {
      flushTimer = setTimeout(() => {
        stream.write(buffer);
        buffer = "";
        flushTimer = void 0;
      }, ESC_TIMEOUT_MS);
    }
  };
  raw.on("data", onData);
  return {
    stdin: stream,
    dispose: () => {
      raw.off("data", onData);
      if (flushTimer !== void 0) {
        clearTimeout(flushTimer);
        flushTimer = void 0;
      }
      if (buffer !== "") stream.write(buffer);
    }
  };
}

// tui-render/src/block-rows.ts
function computeBlockRowsScopeKey(width, theme, fold, renderMode) {
  return `${width}|${theme}|${fold.reasoning ? "r1" : "r0"}|${fold.tools ? "t1" : "t0"}|${renderMode}`;
}
function createMarkdownProjectorState(blockId, scope) {
  const scanner = new TableScanner();
  const closedTableRows = { current: void 0 };
  const baseRenderer = createStyledMarkdownBlockRenderer({
    width: Math.max(1, scope.width),
    hyperlinks: false
  });
  const renderer = {
    renderBlock(node, renderScope, blockIndex) {
      const scannerState = scanner.snapshot();
      const sourceStart = node.position?.start.offset;
      const closedTable = closedTableRows.current;
      if (node.type === "table" && closedTable !== void 0 && sourceStart === closedTable.start) return closedTable.lines;
      if (node.type === "table" && scannerState.state.kind === "confirmed-table" && sourceStart === scannerState.mutableStart) {
        return [];
      }
      return baseRenderer.renderBlock(node, renderScope, blockIndex);
    },
    renderRawTail(text, width, renderScope) {
      return baseRenderer.renderRawTail(text, width, renderScope);
    }
  };
  const projector = createMarkdownProjector(renderer, { cacheLimit: 1024 });
  return {
    blockId,
    scopeKey: scope.scopeKey,
    projector,
    collector: projector.collector,
    scanner,
    lastSource: "",
    stats: () => projector.stats(),
    lastSafeRecompute: void 0,
    cachedProjection: void 0,
    cachedSignature: "",
    tableRenderCache: void 0,
    activeTableProjection: void 0,
    activeTableStart: void 0,
    closedTableRows
  };
}
function projectBlockRows(entry, scope, markdownState) {
  switch (entry.kind) {
    case "markdown":
    case "assistant-prose":
      if (markdownState === void 0) {
        throw new Error("projectBlockRows: markdown entries require a non-undefined markdown state");
      }
      return projectMarkdownEntry(entry, scope, markdownState);
    case "user":
      return projectUserEntry(entry, scope);
    case "reasoning":
      return projectReasoningEntry(entry, scope);
    case "tool-card":
      return projectToolCardEntry(entry, scope);
    case "divider":
      return projectDividerEntry(entry, scope);
    case "compaction":
      return projectCompactionEntry(entry);
    case "turn-tail":
      return projectTurnTailEntry(entry, scope);
    case "tool-summary":
      return projectToolSummaryEntry(entry, scope);
    case "active-placeholder":
      return projectActivePlaceholderEntry(entry);
  }
}
var EMPTY_MARKDOWN_LINE = Object.freeze({
  text: "",
  displayWidth: 0,
  spans: Object.freeze([
    { start: 0, end: 0, token: "fg", bold: false }
  ]),
  rowInBlock: 0,
  sourceStart: 0,
  sourceEnd: 0,
  rawTail: false
});
function projectMarkdownEntry(entry, scope, state) {
  let scannerSnapshot;
  if (entry.source !== state.lastSource) {
    if (!entry.source.startsWith(state.lastSource)) {
      state.collector.reset();
      state.projector.reset();
      state.scanner.reset();
      state.tableRenderCache = void 0;
      state.closedTableRows.current = void 0;
      state.activeTableProjection = void 0;
      state.activeTableStart = void 0;
      state.lastSource = "";
    }
    const delta = entry.source.slice(state.lastSource.length);
    state.collector.append(delta);
    scannerSnapshot = state.scanner.feed(delta);
    state.lastSource = entry.source;
    state.cachedProjection = void 0;
    if (scope.renderMode === "settled") {
      state.collector.finalize();
      scannerSnapshot = state.scanner.finalize();
    }
  }
  const signature = `${entry.source.length}|${scope.scopeKey}|${scope.renderMode}`;
  if (state.cachedProjection !== void 0 && state.cachedSignature === signature && state.lastSource === entry.source) {
    return state.cachedProjection;
  }
  if (scope.renderMode === "settled" && !entry.source.endsWith("\n")) {
    const root = parseMarkdownSource(entry.source, true);
    const renderer = createStyledMarkdownBlockRenderer({
      width: Math.max(1, scope.width),
      hyperlinks: false
    });
    const lines = [];
    for (const [blockIndex, block] of root.children.entries()) {
      appendMarkdownBlock(lines, renderer.renderBlock(
        block,
        {
          width: Math.max(1, scope.width),
          theme: scope.theme,
          fold: "expanded",
          renderMode: scope.renderMode
        },
        blockIndex
      ));
    }
    const next2 = {
      revision: state.collector.revision(),
      sourceLength: entry.source.length,
      lines
    };
    state.cachedProjection = next2;
    state.cachedSignature = signature;
    return next2;
  }
  const renderScope = {
    width: Math.max(1, scope.width),
    theme: scope.theme,
    fold: "expanded",
    renderMode: scope.renderMode
  };
  scannerSnapshot ??= state.scanner.snapshot();
  if (scannerSnapshot.closedTable !== null && state.tableRenderCache !== void 0) {
    const closed = scannerSnapshot.closedTable;
    const rendered = renderStreamingTableCells(
      [closed.header.cells, ...closed.body.map((row) => row.cells)],
      void 0,
      Math.max(1, scope.width),
      0,
      closed.headerStart,
      state.tableRenderCache
    );
    state.tableRenderCache = rendered.cache;
    state.closedTableRows.current = {
      start: closed.headerStart,
      lines: rendered.lines
    };
  }
  const canReuseActiveTableProjection = scannerSnapshot.state.kind === "confirmed-table" && state.activeTableProjection !== void 0 && state.activeTableStart === scannerSnapshot.mutableStart;
  const projection = canReuseActiveTableProjection ? updateProjectionTail(
    state.activeTableProjection,
    entry.source,
    renderScope,
    state.collector.revision()
  ) : state.projector.project(renderScope);
  if (scannerSnapshot.state.kind === "confirmed-table") {
    state.activeTableProjection = projection;
    state.activeTableStart = scannerSnapshot.mutableStart;
  } else {
    state.activeTableProjection = void 0;
    state.activeTableStart = void 0;
    if (state.closedTableRows.current === void 0) state.tableRenderCache = void 0;
  }
  state.lastSafeRecompute = projection.safeRecompute;
  const activeTable = scannerSnapshot.state.kind === "confirmed-table" ? flattenProjectionWithActiveTable(
    projection,
    scannerSnapshot.mutableStart,
    [
      scannerSnapshot.state.header.cells,
      ...scannerSnapshot.state.body.map((row) => row.cells)
    ],
    scope.width,
    state.tableRenderCache
  ) : void 0;
  state.tableRenderCache = activeTable?.cache;
  const next = {
    revision: projection.revision,
    sourceLength: projection.sourceLength,
    lines: activeTable?.lines ?? flattenMarkdownProjection(projection, scope.width)
  };
  state.cachedProjection = next;
  state.cachedSignature = signature;
  return next;
}
function updateProjectionTail(base, source, scope, revision) {
  const rawTail = source.endsWith("\n") ? "" : source.slice(source.lastIndexOf("\n") + 1);
  const escaped = escapeContent(rawTail);
  const renderer = createStyledMarkdownBlockRenderer({
    width: Math.max(1, scope.width),
    hyperlinks: false
  });
  return {
    ...base,
    revision,
    scope,
    tail: escaped === "" ? void 0 : renderer.renderRawTail(escaped, displayWidth(escaped), scope),
    sourceLength: source.length,
    safeRecompute: void 0
  };
}
function flattenProjectionWithActiveTable(projection, tableStart, committedCells, width, previous) {
  const out = [];
  const expectedColumns = committedCells[0]?.length ?? 0;
  const tailCells = projection.tail === void 0 ? void 0 : parsePipeTableCells(projection.tail.text);
  const consumesTail = tailCells !== void 0 && tailCells.length === expectedColumns;
  for (const block of projection.blocks) {
    if (block.range.start === tableStart && block.node.type === "table") {
      const rendered = renderStreamingTableCells(
        committedCells,
        consumesTail ? tailCells : void 0,
        Math.max(1, width),
        0,
        tableStart,
        previous
      );
      appendMarkdownBlock(out, rendered.lines);
      previous = rendered.cache;
      continue;
    }
    appendMarkdownBlock(out, block.lines);
  }
  if (projection.tail !== void 0 && !consumesTail) {
    out.push(...wrapRawTailRows(projection.tail, width));
  }
  return { lines: out, cache: previous };
}
function flattenMarkdownProjection(projection, width) {
  const out = [];
  for (const block of projection.blocks) {
    appendMarkdownBlock(out, block.lines);
  }
  if (projection.tail !== void 0) out.push(...wrapRawTailRows(projection.tail, width));
  return out;
}
var MARKDOWN_BLOCK_GAP_LINE = Object.freeze({
  text: " ",
  displayWidth: 1,
  spans: Object.freeze([{ start: 0, end: 1, token: "fg", bold: false }]),
  rowInBlock: 0,
  sourceStart: -1,
  sourceEnd: -1,
  rawTail: false
});
function appendMarkdownBlock(out, lines) {
  if (lines.length === 0) return;
  if (out.length > 0) out.push(MARKDOWN_BLOCK_GAP_LINE);
  out.push(...lines);
}
function wrapRawTailRows(line5, width) {
  const pieces = wrapDisplayLines(line5.text, Math.max(1, width));
  const style = line5.spans[0] ?? {
    start: 0,
    end: line5.displayWidth,
    token: "fg",
    bold: false
  };
  return pieces.map((text, index) => {
    const row = lineForText(text, style.token, style.bold, line5.rowInBlock + index);
    return {
      ...row,
      sourceStart: index === 0 ? line5.sourceStart : -1,
      sourceEnd: index === pieces.length - 1 ? line5.sourceEnd : -1,
      rawTail: true,
      ...line5.background === void 0 ? {} : { background: line5.background },
      ...line5.backgroundColumns === void 0 ? {} : { backgroundColumns: line5.backgroundColumns }
    };
  });
}
function projectUserEntry(entry, scope) {
  const wrapCols = Math.max(1, scope.width - 2);
  const wrapped = wrapDisplayLines(escapeContent(entry.source), wrapCols);
  const lines = wrapped.map((row, blockRow) => surfaceLine([
    { text: "> ", token: "fgDim", bold: false },
    { text: row, token: "fgSoft", bold: false }
  ], blockRow, "messageBg", scope.width));
  if (entry.meta?.userMessageGap === true) {
    lines.push(...messageGapLines(scope.width, lines.length));
  }
  return { revision: 0, sourceLength: entry.source.length, lines };
}
function projectReasoningEntry(entry, scope) {
  const reasoningDurationMs = entry.meta?.reasoningDurationMs ?? 0;
  const expanded = entry.meta?.reasoningExpanded === true;
  const live = entry.meta?.reasoningLive === true;
  const secondsLabel = (reasoningDurationMs / 1e3).toFixed(1);
  if (!expanded || entry.source === "") {
    return { revision: 0, sourceLength: entry.source.length, lines: [] };
  }
  const icon = live ? getBrailleSpinnerFrame(reasoningDurationMs) : "\u273B";
  const prefix = live ? "" : "\u25BE ";
  const headerLine = surfaceLine([
    ...prefix !== "" ? [{ text: prefix, token: "accentText", bold: false }] : [],
    { text: `${icon} \u601D\u8003`, token: "accentText", bold: false },
    { text: ` (${secondsLabel}s)`, token: "fgDim", bold: false }
  ], 0, "toolBg", scope.width);
  const lines = [headerLine];
  const escaped = escapeContent(entry.source);
  const body = wrapDisplayLines(escaped, Math.max(1, scope.width - 4));
  for (const row of body) {
    const text = `\u2502 ${row}`;
    const cols = displayWidth(text);
    lines.push({
      text,
      displayWidth: cols,
      spans: [
        { start: 0, end: 2, token: "accentText", bold: false },
        { start: 2, end: cols, token: "fgDim", bold: false }
      ],
      rowInBlock: lines.length,
      sourceStart: -1,
      sourceEnd: -1,
      rawTail: false,
      background: "toolBg",
      backgroundColumns: scope.width
    });
  }
  return { revision: 0, sourceLength: entry.source.length, lines };
}
function projectToolCardEntry(entry, scope) {
  const card = entry.meta?.toolCard;
  if (card === void 0) {
    const line5 = lineForText(entry.source, "fg", false, 0);
    return { revision: 0, sourceLength: entry.source.length, lines: [line5] };
  }
  const cache2 = new ToolRowCache(toolPolicyDefaults());
  const lines = cache2.rows(entry.id, card, scope.width, scope.fold.tools, scope.locale ?? "zh-CN").slice();
  return { revision: 0, sourceLength: entry.source.length, lines };
}
function projectDividerEntry(entry, scope) {
  if (entry.source === "" || entry.source === "\u2500") {
    return { revision: 0, sourceLength: entry.source.length, lines: [messageSeparatorLine(scope.width)] };
  }
  const line5 = lineForText(entry.source, "fgDim", false, 0);
  return { revision: 0, sourceLength: entry.source.length, lines: [line5] };
}
function projectCompactionEntry(entry) {
  const shadowed = entry.meta?.compactionShadowedCount;
  const countLabel = shadowed === void 0 ? "" : ` ${String(shadowed)} \u6761`;
  const expanded = entry.meta?.compactionExpanded === true;
  const marker = `\u2500\u2500\u2500\u2500 \u2702 \u5DF2\u538B\u7F29${countLabel} \xB7 Ctrl+K ${expanded ? "\u6298\u53E0" : "\u5C55\u5F00"} \u2500\u2500\u2500\u2500`;
  const lines = [
    lineForText(marker, "fgDim", false, 0)
  ];
  const summary = entry.meta?.compactionSummary ?? "";
  if (expanded && summary !== "") {
    lines.push(mixedLine([
      { text: "\u6458\u8981 ", token: "fgDim", bold: false },
      { text: escapeContent(summary), token: "fg", bold: false }
    ], lines.length));
  }
  return { revision: 0, sourceLength: entry.source.length, lines };
}
function projectTurnTailEntry(entry, scope) {
  const lines = [];
  const produced = entry.meta?.turnTailProduced ?? [];
  if (produced.length > 0) {
    const joined = produced.map(escapeContent).join(" \xB7 ");
    const pathBudget = Math.max(1, scope.width - displayWidth("\u4EA7\u7269 \xB7 "));
    lines.push(lineForText(
      `\u4EA7\u7269 \xB7 ${truncateMiddleDisplay(joined, pathBudget, 0.35)}`,
      "fg",
      false,
      lines.length
    ));
  }
  const stats = entry.meta?.turnTailStats;
  if (stats !== void 0) {
    lines.push(lineForText(stats, "fgDim", false, lines.length));
  }
  if (entry.meta?.turnTailCompletionBoundary === true) {
    lines.push(lineForText("\u2500\u2500 \u5DF2\u5B8C\u6210 \u2500\u2500", "fgDim", false, lines.length));
  }
  return { revision: 0, sourceLength: entry.source.length, lines };
}
function projectToolSummaryEntry(entry, scope) {
  const status = entry.meta?.toolSummaryStatus;
  const token = status === "error" ? "error" : status === "running" ? "accentText" : "fgDim";
  const line5 = lineForText(entry.source, token, false, 0, "toolBg", scope.width);
  return { revision: 0, sourceLength: entry.source.length, lines: [line5] };
}
function projectActivePlaceholderEntry(entry) {
  const text = entry.meta?.activePlaceholder ?? "\u25CF \u6B63\u5728\u601D\u8003\u2026";
  const dotIndex = text.indexOf("\u25CF ");
  const segments = dotIndex >= 0 ? [
    ...dotIndex > 0 ? [{ text: text.slice(0, dotIndex), token: "accentText", bold: true }] : [],
    { text: "\u25CF ", token: "accentText", bold: true },
    { text: text.slice(dotIndex + 2), token: "fg", bold: false }
  ] : [
    { text, token: "fg", bold: false }
  ];
  const line5 = mixedLine(segments, 0);
  return { revision: 0, sourceLength: entry.source.length, lines: [line5] };
}
function lineForText(text, token, bold, blockRow, background, backgroundColumns) {
  const width = displayWidth(text);
  return {
    text,
    displayWidth: width,
    spans: [{ start: 0, end: width, token, bold }],
    rowInBlock: blockRow,
    sourceStart: blockRow === 0 ? 0 : -1,
    sourceEnd: -1,
    rawTail: false,
    ...background === void 0 ? {} : { background },
    ...backgroundColumns === void 0 ? {} : { backgroundColumns }
  };
}
function mixedLine(segments, blockRow) {
  let text = "";
  let width = 0;
  const spans = [];
  for (const segment2 of segments) {
    const segWidth = displayWidth(segment2.text);
    spans.push({
      start: width,
      end: width + segWidth,
      token: segment2.token,
      bold: segment2.bold
    });
    text += segment2.text;
    width += segWidth;
  }
  if (spans.length === 0) {
    spans.push({ start: 0, end: 0, token: "fg", bold: false });
  }
  return {
    text,
    displayWidth: width,
    spans: Object.freeze(spans),
    rowInBlock: blockRow,
    sourceStart: blockRow === 0 ? 0 : -1,
    sourceEnd: -1,
    rawTail: false
  };
}
function surfaceLine(segments, blockRow, background, backgroundColumns) {
  return {
    ...mixedLine(segments, blockRow),
    background,
    backgroundColumns: Math.max(1, backgroundColumns)
  };
}
function messageSeparatorLine(width, rowInBlock = 0) {
  const cols = Math.max(1, width);
  const text = "\u2500".repeat(cols);
  return {
    text,
    displayWidth: cols,
    spans: Object.freeze([{ start: 0, end: cols, token: "line", bold: false }]),
    rowInBlock,
    sourceStart: -1,
    sourceEnd: -1,
    rawTail: false
  };
}
function messageGapLines(width, startRowInBlock = 0) {
  return Object.freeze([
    messageSeparatorLine(width, startRowInBlock),
    {
      ...MARKDOWN_BLOCK_GAP_LINE,
      rowInBlock: startRowInBlock + 1
    }
  ]);
}

// tui-render/src/physical-line.ts
var GRAPHEME_SEGMENTER = new Intl.Segmenter(void 0, { granularity: "grapheme" });
function joinSpanText(spans) {
  let joined = "";
  for (const span of spans) joined += span.text;
  return joined;
}
function graphemeCount(text) {
  let count = 0;
  for (const _segment of GRAPHEME_SEGMENTER.segment(text)) count += 1;
  return count;
}
function createPhysicalLine(input) {
  if (input.blockId === "") {
    throw new Error("createPhysicalLine: blockId must be a non-empty string");
  }
  if (!Number.isInteger(input.sourceStart) || input.sourceStart < 0) {
    throw new Error("createPhysicalLine: sourceStart must be a non-negative integer");
  }
  if (!Number.isInteger(input.sourceEnd) || input.sourceEnd < input.sourceStart) {
    throw new Error("createPhysicalLine: sourceEnd must be an integer >= sourceStart");
  }
  if (!Number.isInteger(input.blockRow) || input.blockRow < 0) {
    throw new Error("createPhysicalLine: blockRow must be a non-negative integer");
  }
  if (input.backgroundColumns !== void 0 && (!Number.isInteger(input.backgroundColumns) || input.backgroundColumns < 1)) {
    throw new Error("createPhysicalLine: backgroundColumns must be a positive integer");
  }
  if (input.osc8 !== void 0 && input.osc8.href === "") {
    throw new Error("createPhysicalLine: osc8.href must be non-empty");
  }
  if (input.osc8 !== void 0 && input.osc8.id === "") {
    throw new Error("createPhysicalLine: osc8.id must be non-empty");
  }
  const text = joinSpanText(input.spans);
  if (input.graphemeSources !== void 0) {
    const expected = graphemeCount(text);
    if (input.graphemeSources.length !== expected) {
      throw new Error(
        `createPhysicalLine: graphemeSources length ${String(input.graphemeSources.length)} does not match text grapheme count ${String(expected)}`
      );
    }
    for (const offset of input.graphemeSources) {
      if (!Number.isInteger(offset) || offset < input.sourceStart || offset > input.sourceEnd) {
        throw new Error(
          "createPhysicalLine: graphemeSources offset must be an integer inside [sourceStart, sourceEnd]"
        );
      }
    }
  }
  const spans = Object.freeze(
    input.spans.map((span) => Object.freeze({
      text: span.text,
      token: span.token,
      ...span.bold === void 0 ? {} : { bold: span.bold },
      ...span.href === void 0 ? {} : { href: span.href }
    }))
  );
  const line5 = {
    blockId: input.blockId,
    text,
    displayWidth: displayWidth(text),
    spans,
    sourceStart: input.sourceStart,
    sourceEnd: input.sourceEnd,
    blockRow: input.blockRow,
    ...input.background === void 0 ? {} : { background: input.background },
    ...input.backgroundColumns === void 0 ? {} : { backgroundColumns: input.backgroundColumns },
    ...input.osc8 === void 0 ? {} : { osc8: Object.freeze({ href: input.osc8.href, id: input.osc8.id }) },
    ...input.graphemeSources === void 0 ? {} : { graphemeSources: Object.freeze([...input.graphemeSources]) }
  };
  return Object.freeze(line5);
}
function physicalLineByteSize(line5) {
  let bytes = 0;
  bytes += line5.text.length;
  for (const span of line5.spans) bytes += span.text.length + (span.href?.length ?? 0);
  bytes += line5.sourceEnd - line5.sourceStart;
  if (line5.osc8 !== void 0) bytes += line5.osc8.href.length + line5.osc8.id.length;
  if (line5.graphemeSources !== void 0) bytes += line5.graphemeSources.length * 4;
  return bytes;
}

// tui-render/src/transcript-line-store.ts
var DEFAULT_TRANSCRIPT_CACHE_MAX_BYTES = 4 * 1024 * 1024;
var MutableRevisionImpl = class {
  blockId;
  revision;
  scopeKey;
  store;
  buffer;
  alive;
  constructor(store, entry, source, scopeKey) {
    this.store = store;
    this.blockId = entry.blockId;
    entry.source = source;
    entry.scopeKey = scopeKey;
    entry.revision += 1;
    entry.priorSettled = entry.settledLines ?? null;
    this.revision = entry.revision;
    this.scopeKey = scopeKey;
    this.buffer = [];
    this.alive = true;
  }
  get lines() {
    return this.buffer;
  }
  append(lines) {
    this.requireAlive();
    this.buffer.push(...lines);
    this.revision += 1;
    this.store.recordTailRerender(lines.length);
    this.store.touchActiveBlock(this.blockId);
  }
  reset(lines) {
    this.requireAlive();
    this.buffer = [...lines];
    this.revision += 1;
    this.store.recordTailRerender(lines.length);
    this.store.touchActiveBlock(this.blockId);
  }
  replace(input) {
    this.requireAlive();
    this.store.replaceActiveSource(this.blockId, input.source);
    this.buffer = [...input.lines];
    this.revision += 1;
    this.store.recordTailRerender(input.lines.length);
    this.store.touchActiveBlock(this.blockId);
  }
  settle() {
    this.requireAlive();
    Object.freeze(this.buffer);
    const snapshot = this.store.commitSettle(this.blockId, this.buffer, this.scopeKey);
    this.alive = false;
    return snapshot;
  }
  discard() {
    this.requireAlive();
    this.store.commitDiscard(this.blockId);
    this.buffer = [];
    this.alive = false;
  }
  requireAlive() {
    if (!this.alive) {
      throw new Error(`MutableRevision(${this.blockId}): handle already settled/discarded`);
    }
  }
};
var TranscriptRenderStoreImpl = class {
  config;
  entries = /* @__PURE__ */ new Map();
  pins = /* @__PURE__ */ new Set();
  accessCounter = 0;
  counters = {
    hits: 0,
    evictions: 0,
    rebuilds: 0,
    stableRowsReused: 0,
    tailRowsRerendered: 0
  };
  constructor(config) {
    if (!Number.isInteger(config.maxRows) || config.maxRows <= 0) {
      throw new Error("createTranscriptRenderStore: maxRows must be a positive integer");
    }
    if (!Number.isInteger(config.maxBytes) || config.maxBytes <= 0) {
      throw new Error("createTranscriptRenderStore: maxBytes must be a positive integer");
    }
    this.config = config;
  }
  upsertSource(input) {
    this.assertBlockId(input.blockId);
    this.assertScopeKey(input.scopeKey);
    const existing = this.entries.get(input.blockId);
    if (existing === void 0) {
      this.entries.set(input.blockId, {
        blockId: input.blockId,
        source: input.source,
        scopeKey: input.scopeKey,
        revision: 0,
        settledLines: void 0,
        priorSettled: null,
        activeRevision: null,
        lastAccess: this.nextAccess()
      });
      this.enforceBudget();
      return;
    }
    if (existing.activeRevision !== null) {
      throw new Error(
        `upsertSource(${input.blockId}): cannot mutate source while an active revision is held`
      );
    }
    const scopeChanged = existing.scopeKey !== input.scopeKey;
    const sourceChanged = existing.source !== input.source;
    existing.source = input.source;
    existing.scopeKey = input.scopeKey;
    existing.lastAccess = this.nextAccess();
    if (scopeChanged || sourceChanged) {
      existing.revision += 1;
      existing.settledLines = null;
    }
    this.enforceBudget();
  }
  acquireActive(input) {
    this.assertBlockId(input.blockId);
    this.assertScopeKey(input.scopeKey);
    let entry = this.entries.get(input.blockId);
    if (entry === void 0) {
      entry = {
        blockId: input.blockId,
        source: input.source,
        scopeKey: input.scopeKey,
        revision: 0,
        settledLines: void 0,
        priorSettled: null,
        activeRevision: null,
        lastAccess: this.nextAccess()
      };
      this.entries.set(input.blockId, entry);
    }
    if (entry.activeRevision !== null) {
      throw new Error(
        `acquireActive(${input.blockId}): another revision is already active for this block`
      );
    }
    const owned = entry;
    const revision = new MutableRevisionImpl(this, owned, input.source, input.scopeKey);
    owned.activeRevision = revision;
    return revision;
  }
  readBlock(input) {
    this.assertBlockId(input.blockId);
    const entry = this.entries.get(input.blockId);
    if (entry === void 0) return void 0;
    entry.lastAccess = this.nextAccess();
    const active = entry.activeRevision;
    if (active !== null) {
      this.counters.stableRowsReused += active.lines.length;
      return snapshotFromEntry(entry, active.lines);
    }
    if (entry.settledLines !== void 0 && entry.settledLines !== null) {
      this.counters.hits += 1;
      this.counters.stableRowsReused += entry.settledLines.length;
      return snapshotFromEntry(entry, entry.settledLines);
    }
    const rebuilt = this.config.rebuild({
      blockId: entry.blockId,
      source: entry.source,
      scopeKey: entry.scopeKey,
      revision: entry.revision
    });
    const frozen = Object.freeze([...rebuilt]);
    entry.settledLines = frozen;
    this.counters.rebuilds += 1;
    this.counters.stableRowsReused += frozen.length;
    this.enforceBudget();
    return snapshotFromEntry(entry, frozen);
  }
  setPins(pins) {
    this.pins.clear();
    for (const id of pins.pinned) {
      this.assertBlockId(id);
      this.pins.add(id);
    }
    this.enforceBudget();
  }
  clearPins() {
    this.pins.clear();
    this.enforceBudget();
  }
  reset() {
    this.entries.clear();
    this.pins.clear();
    this.accessCounter = 0;
    this.counters.hits = 0;
    this.counters.evictions = 0;
    this.counters.rebuilds = 0;
    this.counters.stableRowsReused = 0;
    this.counters.tailRowsRerendered = 0;
  }
  blockRowRange(input) {
    this.assertBlockId(input.blockId);
    const index = input.blockOrder.indexOf(input.blockId);
    if (index < 0) return void 0;
    let start = 0;
    for (let i = 0; i < index; i += 1) {
      const id = input.blockOrder[i];
      const snapshot = this.readBlock({ blockId: id });
      if (snapshot === void 0) {
        continue;
      }
      start += snapshot.rowCount;
    }
    const target = this.readBlock({ blockId: input.blockId });
    if (target === void 0) return void 0;
    return { start, end: start + target.rowCount };
  }
  totalRows() {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += this.linesFor(entry.blockId).length;
    }
    return total;
  }
  stats() {
    let cachedBlocks = 0;
    let cachedRows = 0;
    let cachedBytes = 0;
    for (const entry of this.entries.values()) {
      const lines = this.linesFor(entry.blockId);
      if (lines.length === 0 && entry.settledLines === void 0 && entry.activeRevision === null) {
        continue;
      }
      cachedBlocks += 1;
      cachedRows += lines.length;
      for (const line5 of lines) cachedBytes += physicalLineByteSize(line5);
    }
    return {
      hits: this.counters.hits,
      evictions: this.counters.evictions,
      rebuilds: this.counters.rebuilds,
      stableRowsReused: this.counters.stableRowsReused,
      tailRowsRerendered: this.counters.tailRowsRerendered,
      cachedBlocks,
      cachedRows,
      cachedBytes
    };
  }
  /** Internal: called by MutableRevisionImpl on settle. */
  commitSettle(blockId, frozen, scopeKey) {
    const entry = this.entries.get(blockId);
    if (entry === void 0) {
      throw new Error(`commitSettle(${blockId}): missing entry`);
    }
    if (entry.activeRevision === null) {
      throw new Error(`commitSettle(${blockId}): no active revision to settle`);
    }
    entry.activeRevision = null;
    entry.scopeKey = scopeKey;
    entry.settledLines = frozen;
    entry.priorSettled = null;
    entry.lastAccess = this.nextAccess();
    this.enforceBudget();
    return snapshotFromEntry(entry, frozen);
  }
  /** Internal: called by MutableRevisionImpl on discard. */
  commitDiscard(blockId) {
    const entry = this.entries.get(blockId);
    if (entry === void 0) {
      throw new Error(`commitDiscard(${blockId}): missing entry`);
    }
    entry.activeRevision = null;
    entry.settledLines = entry.priorSettled ?? null;
    entry.priorSettled = null;
    entry.lastAccess = this.nextAccess();
    this.enforceBudget();
  }
  /** Internal: called from the revision to bump tail counters. */
  recordTailRerender(rowCount) {
    this.counters.tailRowsRerendered += rowCount;
  }
  /** Internal: called from the revision to refresh LRU access on the owning block. */
  touchActiveBlock(blockId) {
    const entry = this.entries.get(blockId);
    if (entry !== void 0) entry.lastAccess = this.nextAccess();
  }
  /** Internal: keep source authority current while an active handle lives. */
  replaceActiveSource(blockId, source) {
    const entry = this.entries.get(blockId);
    if (entry === void 0 || entry.activeRevision === null) {
      throw new Error(`replaceActiveSource(${blockId}): no active revision`);
    }
    entry.source = source;
    entry.revision += 1;
  }
  linesFor(blockId) {
    const entry = this.entries.get(blockId);
    if (entry === void 0) return EMPTY_LINES;
    if (entry.activeRevision !== null) return entry.activeRevision.lines;
    if (entry.settledLines !== void 0 && entry.settledLines !== null) return entry.settledLines;
    return EMPTY_LINES;
  }
  assertBlockId(blockId) {
    if (typeof blockId !== "string" || blockId === "") {
      throw new Error("TranscriptRenderStore: blockId must be a non-empty string");
    }
  }
  assertScopeKey(scopeKey) {
    if (typeof scopeKey !== "string" || scopeKey === "") {
      throw new Error("TranscriptRenderStore: scopeKey must be a non-empty string");
    }
  }
  nextAccess() {
    this.accessCounter += 1;
    return this.accessCounter;
  }
  /** Evict unpinned settled blocks until both row and byte budgets fit. */
  enforceBudget() {
    const totals = this.computeTotals();
    if (totals.rows <= this.config.maxRows && totals.bytes <= this.config.maxBytes) return;
    const candidates = [];
    for (const entry of this.entries.values()) {
      if (this.pins.has(entry.blockId)) continue;
      if (entry.activeRevision !== null) continue;
      if (entry.settledLines === null || entry.settledLines === void 0) continue;
      candidates.push(entry);
    }
    candidates.sort((a, b) => a.lastAccess - b.lastAccess);
    for (const entry of candidates) {
      if (totals.rows <= this.config.maxRows && totals.bytes <= this.config.maxBytes) break;
      const settled = entry.settledLines;
      const rowCount = settled.length;
      let byteCount = 0;
      for (const line5 of settled) byteCount += physicalLineByteSize(line5);
      entry.settledLines = null;
      entry.lastAccess = 0;
      this.counters.evictions += 1;
      totals.rows -= rowCount;
      totals.bytes -= byteCount;
    }
  }
  computeTotals() {
    let rows = 0;
    let bytes = 0;
    for (const entry of this.entries.values()) {
      const lines = entry.activeRevision === null ? entry.settledLines ?? EMPTY_LINES : entry.activeRevision.lines;
      for (const line5 of lines) {
        rows += 1;
        bytes += physicalLineByteSize(line5);
      }
    }
    return { rows, bytes };
  }
};
var EMPTY_LINES = Object.freeze([]);
function snapshotFromEntry(entry, lines) {
  return Object.freeze({
    blockId: entry.blockId,
    source: entry.source,
    scopeKey: entry.scopeKey,
    revision: entry.revision,
    lines,
    rowCount: lines.length
  });
}
function createTranscriptRenderStore(config) {
  return new TranscriptRenderStoreImpl(config);
}

// tui-render/src/scroll-scheduler.ts
var SCROLL_SCHEDULER_DEFAULT_FRAME_INTERVAL_MS = 16;
var SCROLL_SCHEDULER_DEFAULT_STEP_PER_FRAME = 1;
var SCROLL_SCHEDULER_DEFAULT_CATCH_UP_THRESHOLD = 10;
var SCROLL_SCHEDULER_DEFAULT_MAX_CATCH_UP_STEP = 8;
function createScrollScheduler(options = {}) {
  const frameIntervalMs = options.frameIntervalMs ?? SCROLL_SCHEDULER_DEFAULT_FRAME_INTERVAL_MS;
  const stepPerFrame = options.stepPerFrame ?? SCROLL_SCHEDULER_DEFAULT_STEP_PER_FRAME;
  const catchUpThreshold = options.catchUpThreshold ?? SCROLL_SCHEDULER_DEFAULT_CATCH_UP_THRESHOLD;
  const maxCatchUpStep = options.maxCatchUpStep ?? SCROLL_SCHEDULER_DEFAULT_MAX_CATCH_UP_STEP;
  const setIntervalFn = options.setInterval ?? setInterval;
  const clearIntervalFn = options.clearInterval ?? clearInterval;
  const autoSchedule = options.autoSchedule ?? true;
  let presented = options.initialPosition ?? 0;
  let target = options.initialPosition ?? 0;
  let timer;
  let disposed = false;
  let catchingUp = false;
  function catchUpStep(delta) {
    const abs = Math.abs(delta);
    const base = catchingUp ? maxCatchUpStep : stepPerFrame;
    return Math.min(abs, base);
  }
  function stopTimer() {
    if (timer === void 0) return;
    clearIntervalFn(timer);
    timer = void 0;
  }
  function ensureTimer() {
    if (!autoSchedule) return;
    if (timer !== void 0) return;
    timer = setIntervalFn(stepOnce, frameIntervalMs);
  }
  function stepOnce() {
    if (presented === target) return presented;
    const delta = target - presented;
    presented += Math.sign(delta) * catchUpStep(delta);
    if (presented === target) stopTimer();
    return presented;
  }
  return {
    getPresented: () => presented,
    getTarget: () => target,
    isAnimating: () => !disposed && presented !== target,
    setTarget(row) {
      if (disposed) return;
      target = row;
      catchingUp = Math.abs(target - presented) > catchUpThreshold;
      if (presented !== target) ensureTimer();
      else stopTimer();
    },
    snapTo(row) {
      if (disposed) return;
      presented = row;
      target = row;
      catchingUp = false;
      stopTimer();
    },
    rebase(delta, maximum) {
      if (disposed) return;
      const cap = Math.max(0, Math.trunc(maximum));
      presented = Math.max(0, Math.min(cap, presented + Math.trunc(delta)));
      target = Math.max(0, Math.min(cap, target + Math.trunc(delta)));
      if (presented === target) stopTimer();
      else ensureTimer();
    },
    tick() {
      if (disposed) return presented;
      return stepOnce();
    },
    dispose() {
      disposed = true;
      stopTimer();
    }
  };
}

// tui-render/src/stream-queue.ts
var STREAM_QUEUE_DEFAULT_SMOOTH_ROWS_PER_FRAME = 2;
var STREAM_QUEUE_DEFAULT_CATCH_UP_ROWS_PER_FRAME = 16;
var STREAM_QUEUE_DEFAULT_ENTRY_DEPTH = 64;
var STREAM_QUEUE_DEFAULT_EXIT_DEPTH = 32;
var STREAM_QUEUE_DEFAULT_MAX_OLDEST_AGE_MS = 500;
var STREAM_QUEUE_DEFAULT_EXIT_OLDEST_AGE_MS = 250;
var STREAM_QUEUE_DEFAULT_DRAIN_BACKPRESSURE_MS = 100;
var STREAM_QUEUE_DEFAULT_EXIT_DRAIN_BACKPRESSURE_MS = 50;
var STREAM_QUEUE_DEFAULT_RECOVERY_DEBOUNCE_MS = 100;
function createStreamQueue(options = {}) {
  const smoothRowsPerFrame = options.smoothRowsPerFrame ?? STREAM_QUEUE_DEFAULT_SMOOTH_ROWS_PER_FRAME;
  const catchUpRowsPerFrame = options.catchUpRowsPerFrame ?? STREAM_QUEUE_DEFAULT_CATCH_UP_ROWS_PER_FRAME;
  const entryDepth = options.entryDepth ?? STREAM_QUEUE_DEFAULT_ENTRY_DEPTH;
  const exitDepth = options.exitDepth ?? STREAM_QUEUE_DEFAULT_EXIT_DEPTH;
  const maxOldestAgeMs = options.maxOldestAgeMs ?? STREAM_QUEUE_DEFAULT_MAX_OLDEST_AGE_MS;
  const exitOldestAgeMs = options.exitOldestAgeMs ?? STREAM_QUEUE_DEFAULT_EXIT_OLDEST_AGE_MS;
  const drainBackpressureMs = options.drainBackpressureMs ?? STREAM_QUEUE_DEFAULT_DRAIN_BACKPRESSURE_MS;
  const exitDrainBackpressureMs = options.exitDrainBackpressureMs ?? STREAM_QUEUE_DEFAULT_EXIT_DRAIN_BACKPRESSURE_MS;
  const recoveryDebounceMs = options.recoveryDebounceMs ?? STREAM_QUEUE_DEFAULT_RECOVERY_DEBOUNCE_MS;
  const maxDepth = options.maxDepth;
  const queue = [];
  let mode = "smooth";
  let drainPressureMs = 0;
  let recoveringSinceMs;
  function ageMs(nowMs) {
    const head = queue[0];
    if (head === void 0) return 0;
    return Math.max(0, nowMs - head.enqueuedAtMs);
  }
  function inCatchUp(nowMs) {
    return queue.length > entryDepth || ageMs(nowMs) > maxOldestAgeMs || drainPressureMs > drainBackpressureMs;
  }
  function underExit(nowMs) {
    return queue.length <= exitDepth && ageMs(nowMs) <= exitOldestAgeMs && drainPressureMs <= exitDrainBackpressureMs;
  }
  function updateMode(nowMs) {
    if (mode === "smooth") {
      if (inCatchUp(nowMs)) {
        mode = "catch-up";
        recoveringSinceMs = void 0;
      }
      return;
    }
    if (underExit(nowMs)) {
      if (recoveringSinceMs === void 0) {
        recoveringSinceMs = nowMs;
      } else if (nowMs - recoveringSinceMs >= recoveryDebounceMs) {
        mode = "smooth";
        recoveringSinceMs = void 0;
      }
    } else {
      recoveringSinceMs = void 0;
    }
  }
  function budget() {
    return mode === "catch-up" ? catchUpRowsPerFrame : smoothRowsPerFrame;
  }
  function dequeue(max) {
    if (max <= 0 || queue.length === 0) return [];
    const count = Math.min(max, queue.length);
    return queue.splice(0, count).map((entry) => entry.row);
  }
  return {
    push(rows, nowMs) {
      for (const row of rows) {
        queue.push({ row, enqueuedAtMs: nowMs });
      }
      if (maxDepth !== void 0 && queue.length > maxDepth) {
        queue.splice(0, queue.length - maxDepth);
      }
    },
    pullReady(max) {
      return dequeue(max);
    },
    noteDrain(pressureMs) {
      drainPressureMs = Math.max(0, pressureMs);
    },
    getMode() {
      return mode;
    },
    getStats(nowMs) {
      return {
        mode,
        depth: queue.length,
        oldestAgeMs: ageMs(nowMs),
        drainPressureMs,
        recoveringForMs: recoveringSinceMs === void 0 ? 0 : nowMs - recoveringSinceMs
      };
    },
    tick(nowMs) {
      updateMode(nowMs);
      return dequeue(budget());
    },
    flush() {
      recoveringSinceMs = void 0;
      return dequeue(queue.length);
    }
  };
}

// tui-render/src/frame-arbiter.ts
var FRAME_ARBITER_DEFAULT_FRAME_INTERVAL_MS = 16;
function createFrameArbiter(options) {
  const frameIntervalMs = options.frameIntervalMs ?? FRAME_ARBITER_DEFAULT_FRAME_INTERVAL_MS;
  const ownsScrollScheduler = options.ownsScrollScheduler ?? true;
  const drivesScrollScheduler = options.drivesScrollScheduler ?? false;
  const demandDriven = options.demandDriven ?? false;
  const setIntervalFn = options.setInterval ?? setInterval;
  const clearIntervalFn = options.clearInterval ?? clearInterval;
  const nowFn = options.now ?? Date.now;
  const scroll = options.scroll;
  const stream = options.stream;
  const listeners = /* @__PURE__ */ new Set();
  let timer;
  let pendingStream = false;
  let pendingScroll = false;
  let lastPresented = scroll.getPresented();
  let lastScrollActivityMs = -Infinity;
  let disposed = false;
  function ensureTimer() {
    if (disposed || timer !== void 0) return;
    timer = setIntervalFn(tickFrame, frameIntervalMs);
  }
  function readScrollState() {
    return {
      presented: scroll.getPresented(),
      target: scroll.getTarget(),
      isAnimating: scroll.isAnimating()
    };
  }
  function tickFrame() {
    const nowMs = nowFn();
    if (drivesScrollScheduler && scroll.getPresented() !== scroll.getTarget()) {
      scroll.tick();
    }
    const streamRows = stream.tick(nowMs);
    const scrollState = readScrollState();
    const scrollMoved = scrollState.presented !== lastPresented;
    lastPresented = scrollState.presented;
    if (scrollMoved || scrollState.isAnimating || pendingScroll) {
      lastScrollActivityMs = nowMs;
    }
    const naturalWork = streamRows.length > 0 || scrollMoved || scrollState.isAnimating;
    const shouldPublish = pendingStream || pendingScroll || naturalWork;
    if (shouldPublish) {
      publish({
        scroll: scrollState,
        stream: streamRows,
        nowMs,
        forced: !naturalWork && (pendingStream || pendingScroll)
      });
    }
    pendingStream = false;
    pendingScroll = false;
    if (demandDriven) {
      const busy = scrollState.isAnimating || stream.getStats(nowMs).depth > 0;
      if (!busy && timer !== void 0) {
        clearIntervalFn(timer);
        timer = void 0;
      }
    }
  }
  function publish(snapshot) {
    for (const listener of listeners) listener(snapshot);
  }
  if (!demandDriven) {
    timer = setIntervalFn(tickFrame, frameIntervalMs);
  }
  return {
    onPublish(listener) {
      if (disposed) return () => void 0;
      listeners.add(listener);
      let disposedSubscription = false;
      return () => {
        if (disposedSubscription) return;
        disposedSubscription = true;
        listeners.delete(listener);
      };
    },
    requestStream() {
      if (disposed) return;
      pendingStream = true;
      if (demandDriven) ensureTimer();
    },
    requestScroll() {
      if (disposed) return;
      pendingScroll = true;
      lastScrollActivityMs = nowFn();
      if (demandDriven) ensureTimer();
    },
    getScrollState: readScrollState,
    isRunning: () => timer !== void 0,
    hasPendingRequest: () => pendingStream || pendingScroll,
    isScrollActive: () => {
      if (disposed) return false;
      const scrollState = readScrollState();
      return pendingScroll || scrollState.isAnimating || nowFn() - lastScrollActivityMs < 150;
    },
    dispose() {
      if (timer !== void 0) {
        clearIntervalFn(timer);
        timer = void 0;
      }
      if (disposed) return;
      disposed = true;
      pendingStream = false;
      pendingScroll = false;
      listeners.clear();
      if (ownsScrollScheduler) scroll.dispose();
    }
  };
}

// tui-render/src/stream-view.tsx
import { jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
var ASSISTANT_PROSE_PREFIX_COLUMNS = displayWidth("\u25CF ");
var LIVE_DURATION_TICK_MS = 100;
function assistantProseScope(scope) {
  const width = Math.max(1, scope.width - ASSISTANT_PROSE_PREFIX_COLUMNS * 2);
  const fold = { reasoning: false, tools: false };
  return {
    ...scope,
    width,
    fold,
    scopeKey: computeBlockRowsScopeKey(
      width,
      scope.theme,
      fold,
      scope.renderMode
    )
  };
}
function isVisiblePart(part) {
  if (part.kind === "card" || part.kind === "tool-summary") return true;
  return part.text !== "";
}
function displayedParts(parts, reasoningExpanded) {
  return parts.filter((part) => isVisiblePart(part) && (part.kind !== "reasoning" || reasoningExpanded));
}
var COLLAPSED_TOOL_CARD_LIMIT = 3;
function toolSummaryStatus(summary) {
  if (summary.errorCount > 0) return "error";
  return summary.runningCount > 0 ? "running" : "ok";
}
function toolSummaryText(summary, maxCols) {
  const status = [
    summary.okCount > 0 && (summary.errorCount > 0 || summary.runningCount > 0) ? `\u5B8C\u6210 ${String(summary.okCount)}` : void 0,
    summary.errorCount > 0 ? `\u5931\u8D25 ${String(summary.errorCount)}` : void 0,
    summary.runningCount > 0 ? `\u8FD0\u884C\u4E2D ${String(summary.runningCount)}` : void 0
  ].filter((value) => value !== void 0);
  const full = [
    `\u25B8 \u5DE5\u5177\u8BB0\u5F55 \xB7 \u5DF2\u6536\u8D77 ${String(summary.hiddenCount)} \u4E2A`,
    ...status,
    "Ctrl+E \u5C55\u5F00"
  ].join(" \xB7 ");
  if (displayWidth(full) <= maxCols) return full;
  const compactStatus = [
    summary.errorCount > 0 ? `\u5931\u8D25${String(summary.errorCount)}` : void 0,
    summary.runningCount > 0 ? `\u8FD0\u884C${String(summary.runningCount)}` : void 0
  ].filter((value) => value !== void 0);
  const compact = [`\u25B8 \u5DE5\u5177 ${String(summary.hiddenCount)}`, ...compactStatus, "Ctrl+E"].join(" \xB7 ");
  if (displayWidth(compact) <= maxCols) return compact;
  const suffix = " \xB7 Ctrl+E";
  const prefixBudget = maxCols - displayWidth(suffix);
  if (prefixBudget <= 0) return truncateDisplay("Ctrl+E", maxCols);
  return `${truncateDisplay(`\u25B8 ${String(summary.hiddenCount)} \u5DE5\u5177`, prefixBudget)}${suffix}`;
}
function compactToolParts(parts, toolCardsExpanded, presenters, mode, cache2) {
  if (mode === "focus") {
    return parts.filter((part) => part.kind !== "card" && part.kind !== "tool-summary");
  }
  const presentedParts = parts.map((part) => part.kind === "card" ? { kind: "card", card: cache2 === void 0 ? attachPresenterViews(presenters, part.card) : cache2.present(presenters, part.card) } : part);
  const cards = presentedParts.flatMap((part, index) => part.kind === "card" ? [{ index, status: toolCardDisplayStatus(part.card) }] : []);
  if (toolCardsExpanded || cards.length <= COLLAPSED_TOOL_CARD_LIMIT) return presentedParts;
  const retained = /* @__PURE__ */ new Set();
  const retainLatest = (status) => {
    const match = cards.findLast((card) => card.status === status);
    if (match !== void 0) retained.add(match.index);
  };
  retainLatest("running");
  retainLatest("error");
  for (let index = cards.length - 1; index >= 0 && retained.size < COLLAPSED_TOOL_CARD_LIMIT; index -= 1) {
    const card = cards[index];
    if (card !== void 0) retained.add(card.index);
  }
  const hidden = cards.filter((card) => !retained.has(card.index));
  const firstHiddenIndex = hidden[0]?.index;
  const summary = {
    hiddenCount: hidden.length,
    okCount: hidden.filter((card) => card.status === "ok").length,
    errorCount: hidden.filter((card) => card.status === "error").length,
    runningCount: hidden.filter((card) => card.status === "running").length
  };
  return presentedParts.flatMap((part, index) => {
    if (part.kind !== "card" || retained.has(index)) return [part];
    return index === firstHiddenIndex ? [{ kind: "tool-summary", summary }] : [];
  });
}
function turnPartGap(parts, index) {
  if (index === 0) return 0;
  const previous = parts[index - 1];
  const current = parts[index];
  const previousIsTool = previous?.kind === "card" || previous?.kind === "tool-summary";
  const currentIsTool = current?.kind === "card" || current?.kind === "tool-summary";
  return previousIsTool && currentIsTool ? 0 : 1;
}
var EMPTY_COMPACTION_DIVIDERS = Object.freeze([]);
function transcriptBlockId(row) {
  if (row.kind === "compaction") return `compaction-${row.divider.compactionId}`;
  if (row.message.kind === "assistant" && row.message.turnOrdinal !== void 0) {
    return `assistant-turn-${String(row.message.turnOrdinal)}`;
  }
  return `message-${String(row.message.id)}`;
}
function transcriptBlockVersion(row, revisions) {
  return revisions.revision(row.kind === "compaction" ? row.divider : row.message);
}
function activeTurnVersion(turn, revisions) {
  return revisions.revision(turn, [
    turn.assistantText,
    turn.reasoningText,
    turn.reasoningDurationMs,
    turn.reason,
    ...turn.toolCalls.flatMap((call) => [call.callId, call.name, call.arguments]),
    ...turn.content ?? []
  ]);
}
function compactionDividerLabel(divider, expanded) {
  const count = divider.shadowedCount === void 0 ? "" : ` ${String(divider.shadowedCount)} \u6761`;
  return `\u2500\u2500\u2500\u2500 \u2702 \u5DF2\u538B\u7F29${count} \xB7 Ctrl+K ${expanded ? "\u6298\u53E0" : "\u5C55\u5F00"} \u2500\u2500\u2500\u2500`;
}
function partsFrom(content) {
  const parts = [];
  const pending = /* @__PURE__ */ new Map();
  for (const item of content) {
    if (item.kind === "text") {
      const last = parts[parts.length - 1];
      if (last !== void 0 && last.kind === "text") {
        last.text += item.text;
        continue;
      }
      parts.push({ kind: "text", text: item.text });
      continue;
    }
    if (item.kind === "reasoning") {
      const last = parts[parts.length - 1];
      if (last !== void 0 && last.kind === "reasoning") {
        last.text += item.text;
        last.durationMs += item.durationMs ?? 0;
        continue;
      }
      parts.push({
        kind: "reasoning",
        text: item.text,
        durationMs: item.durationMs ?? 0
      });
      continue;
    }
    if (item.kind === "tool-call") {
      const card2 = {
        callId: item.callId,
        name: item.name,
        arguments: item.arguments,
        status: "running"
      };
      pending.set(item.callId, card2);
      parts.push({ kind: "card", card: card2 });
      continue;
    }
    const card = pending.get(item.callId);
    if (card === void 0) continue;
    card.status = item.isError ? "error" : "ok";
    card.resultText = item.text;
    if (item.meta !== void 0) card.meta = item.meta;
    if (item.error !== void 0) card.error = item.error;
  }
  return parts;
}
function stampLastRun(parts, durationMs) {
  if (durationMs === void 0) return;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part === void 0 || part.kind !== "reasoning") continue;
    if (part.durationMs === 0) part.durationMs = durationMs;
    return;
  }
}
function partsFromFrozen(message) {
  if (message.content === void 0) {
    const parts2 = [];
    if (message.reasoningText !== void 0 && message.reasoningText !== "") {
      parts2.push({
        kind: "reasoning",
        text: message.reasoningText,
        durationMs: message.reasoningDurationMs ?? 0
      });
    }
    parts2.push({ kind: "text", text: message.text });
    return parts2;
  }
  const parts = partsFrom(message.content);
  stampLastRun(parts, message.reasoningDurationMs);
  return parts;
}
function partsFromTurn(turn) {
  if (turn.content === void 0) {
    const parts2 = [];
    if (turn.reasoningText !== "") {
      parts2.push({
        kind: "reasoning",
        text: turn.reasoningText,
        durationMs: turn.reasoningDurationMs
      });
    }
    parts2.push({ kind: "text", text: turn.assistantText });
    for (const card of cardsFromActiveTurn(turn.toolCalls)) {
      parts2.push({ kind: "card", card });
    }
    return parts2;
  }
  const parts = partsFrom(turn.content);
  const seen = /* @__PURE__ */ new Set();
  for (const item of turn.content) {
    if (item.kind === "tool-call") seen.add(item.callId);
  }
  const missing = turn.toolCalls.filter((call) => !seen.has(call.callId));
  for (const card of cardsFromActiveTurn(missing, turn.content)) {
    parts.push({ kind: "card", card });
  }
  return parts;
}
function liveDurationTarget(turn, status) {
  if (turn === void 0 || status !== "generating") return void 0;
  const parts = partsFromTurn(turn);
  const visibleParts = parts.filter(isVisiblePart);
  if (visibleParts.length === 0) {
    return {
      identity: `turn-${String(turn.turn)}-pending`,
      durationMs: turn.reasoningDurationMs
    };
  }
  const index = parts.findLastIndex(isVisiblePart);
  const part = parts[index];
  if (part?.kind === "reasoning") {
    return {
      identity: `turn-${String(turn.turn)}-reasoning-${String(index)}`,
      durationMs: part.durationMs
    };
  }
  if (part?.kind === "card" && part.card.status !== "running" || part?.kind === "tool-summary" && part.summary.runningCount === 0) {
    return {
      identity: `turn-${String(turn.turn)}-pending-after-tool-${String(index)}`,
      durationMs: turn.reasoningDurationMs
    };
  }
  return void 0;
}
function useLiveDuration(target) {
  const [clock, setClock] = useState2(() => Date.now());
  const sample = useRef3(void 0);
  const sampledAt = Date.now();
  if (target === void 0) {
    sample.current = void 0;
  } else if (sample.current === void 0 || sample.current.identity !== target.identity) {
    sample.current = {
      identity: target.identity,
      observedMs: target.durationMs,
      baseMs: target.durationMs,
      sampledAt
    };
  } else if (sample.current.observedMs !== target.durationMs) {
    const advancedMs = sample.current.baseMs + Math.max(0, sampledAt - sample.current.sampledAt);
    sample.current = {
      identity: target.identity,
      observedMs: target.durationMs,
      baseMs: Math.max(target.durationMs, advancedMs),
      sampledAt
    };
  }
  const identity = target?.identity;
  useEffect2(() => {
    if (identity === void 0) return;
    const timer = setInterval(() => {
      setClock(Date.now());
    }, LIVE_DURATION_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [identity]);
  const current = sample.current;
  if (current === void 0) return void 0;
  return current.baseMs + Math.max(0, Math.max(clock, sampledAt) - current.sampledAt);
}
function kindMarker(glyph, token) {
  return paintRow([styled(escapeContent(glyph), token)]);
}
function restIndent() {
  return paintRow([styled("  ", "bg")]);
}
var SettledMarkdownBlock = memo(function SettledMarkdownBlock2(props) {
  return /* @__PURE__ */ jsx6(
    MarkdownBlock,
    {
      source: props.source,
      maxCols: props.maxCols,
      prefix: { first: kindMarker("\u25CF ", "accentText"), rest: restIndent() },
      settled: true
    }
  );
});
function userRun(text, columns) {
  return paintBackgroundRow([
    styled(escapeContent("> "), "fgDim"),
    styled(escapeContent(text), "fgSoft")
  ], "messageBg", columns);
}
function activeMarker() {
  return paintRow([styled(escapeContent("\u25CF "), "accentText", void 0, true)]);
}
function latestAssistantId(history, activeTurn) {
  if (activeTurn !== void 0) return void 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message === void 0) continue;
    if (message.kind === "assistant") return message.id;
  }
  return void 0;
}
var baseMarkdownLineCache = /* @__PURE__ */ new WeakMap();
function markdownLineToPhysicalLine(blockId, line5) {
  let byBlock = baseMarkdownLineCache.get(line5);
  if (byBlock === void 0) {
    byBlock = /* @__PURE__ */ new Map();
    baseMarkdownLineCache.set(line5, byBlock);
  }
  const cached = byBlock.get(blockId);
  if (cached !== void 0) return cached;
  const segments = [];
  for (const span of line5.spans) {
    const text = displayColumnSlice(line5.text, span.start, span.end);
    if (text === "") continue;
    segments.push({
      text,
      token: span.token,
      bold: span.bold,
      ...span.href === void 0 ? {} : { href: span.href }
    });
  }
  const sourceStart = Math.max(0, line5.sourceStart);
  const sourceEnd = Math.max(sourceStart, line5.sourceEnd < 0 ? sourceStart : line5.sourceEnd);
  const created = createPhysicalLine({
    blockId,
    spans: segments.length === 0 ? [{ text: "", token: "fg", bold: false }] : segments,
    sourceStart,
    sourceEnd,
    blockRow: Math.max(0, line5.rowInBlock),
    ...line5.background === void 0 ? {} : { background: line5.background },
    ...line5.backgroundColumns === void 0 ? {} : { backgroundColumns: line5.backgroundColumns }
  });
  byBlock.set(blockId, created);
  return created;
}
function overlayPromptOnSpans(spans, prompt) {
  const result = [];
  let col = 0;
  for (const span of spans) {
    const spanWidth = displayWidth(span.text);
    if (col + spanWidth <= prompt.startCol) {
      result.push(span);
      col += spanWidth;
    } else if (col < prompt.startCol) {
      const budget = prompt.startCol - col;
      const truncated = truncateDisplay(span.text, budget);
      if (truncated !== "") {
        result.push({ ...span, text: truncated });
      }
      col = prompt.startCol;
      break;
    } else {
      break;
    }
  }
  if (col < prompt.startCol) {
    result.push({
      text: " ".repeat(prompt.startCol - col),
      token: "bg",
      bold: false
    });
  }
  result.push({
    text: prompt.text,
    token: "accentText",
    bold: false
  });
  return result;
}
var frameLineCache = /* @__PURE__ */ new WeakMap();
function clonePhysicalLineWithSpans(base, blockId, spans) {
  return createPhysicalLine({
    blockId,
    spans,
    sourceStart: base.sourceStart,
    sourceEnd: base.sourceEnd,
    blockRow: base.blockRow,
    ...base.background === void 0 ? {} : { background: base.background },
    ...base.backgroundColumns === void 0 ? {} : { backgroundColumns: base.backgroundColumns }
  });
}
function framePhysicalLine(blockId, line5, lead, active, prompt) {
  if (prompt === void 0) {
    let byLine = frameLineCache.get(line5);
    if (byLine === void 0) {
      byLine = /* @__PURE__ */ new Map();
      frameLineCache.set(line5, byLine);
    }
    const key = `${blockId}:${lead}:${active ? "1" : "0"}`;
    const cached = byLine.get(key);
    if (cached !== void 0) return cached;
    const base2 = markdownLineToPhysicalLine(blockId, line5);
    const spans2 = lead === "" ? base2.spans : [
      {
        text: lead,
        token: lead.trim() === "" ? "bg" : "accentText",
        bold: active && lead.trim() !== ""
      },
      ...base2.spans
    ];
    const created = lead === "" ? base2 : clonePhysicalLineWithSpans(base2, blockId, spans2);
    byLine.set(key, created);
    return created;
  }
  const base = markdownLineToPhysicalLine(blockId, line5);
  const initialSpans = [
    ...lead === "" ? [] : [{
      text: lead,
      token: lead.trim() === "" ? "bg" : "accentText",
      bold: active && lead.trim() !== ""
    }],
    ...base.spans
  ];
  const spans = overlayPromptOnSpans(initialSpans, prompt);
  return clonePhysicalLineWithSpans(base, blockId, spans);
}
function projectorStateFor(cache2, blockId, scope, aliases = [], source) {
  const projectorScope = scope.scopeKey.replace(/\|(streaming|settled)$/u, "");
  const key = `${blockId}|${projectorScope}`;
  let state = cache2.get(key);
  if (state === void 0) {
    for (const alias of aliases) {
      state = cache2.get(`${alias}|${projectorScope}`);
      if (state !== void 0) break;
    }
  }
  if (state === void 0 && source !== void 0) {
    for (const candidate of cache2.values()) {
      const candidateScope = candidate.scopeKey.replace(/\|(streaming|settled)$/u, "");
      if (candidateScope === projectorScope && candidate.lastSource === source) {
        state = candidate;
        break;
      }
    }
  }
  if (state === void 0) {
    state = createMarkdownProjectorState(blockId, scope);
  }
  cache2.set(key, state);
  return state;
}
var EMPTY_TEXT_RANGES = [];
var GAP_LINE = Object.freeze({
  text: " ",
  displayWidth: 1,
  spans: Object.freeze([{ start: 0, end: 1, token: "fg", bold: false }]),
  rowInBlock: 0,
  sourceStart: -1,
  sourceEnd: -1,
  rawTail: false
});
function slicedLead(prefix, textRanges, index) {
  for (const range of textRanges) {
    if (index === range.start) {
      return prefix.first;
    }
    if (index > range.start && index < range.end) {
      return prefix.rest;
    }
  }
  return "";
}
function snapshotLead(textRanges, index) {
  for (const range of textRanges) {
    if (index === range.start) return "\u25CF ";
    if (index > range.start && index < range.end) return "  ";
  }
  return "";
}
function sliceWindow(lineCount, layoutTop, overscanTop, overscanBottom) {
  const start = Math.max(0, Math.floor(overscanTop - layoutTop));
  return {
    start,
    end: Math.max(start, Math.min(lineCount, Math.ceil(overscanBottom - layoutTop)))
  };
}
function intersectingLayoutIndexes(layouts, start, end) {
  let low = 0;
  let high = layouts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const layout = layouts[middle];
    if (layout.top + layout.rows <= start) low = middle + 1;
    else high = middle;
  }
  const indexes = [];
  for (let index = low; index < layouts.length; index += 1) {
    const layout = layouts[index];
    if (layout.top >= end) break;
    indexes.push(index);
  }
  return indexes;
}
var paintedRenderLineCache = /* @__PURE__ */ new WeakMap();
function cachedPaintedRenderLine(line5, cacheKey, hyperlinks2) {
  let variants = paintedRenderLineCache.get(line5);
  if (variants === void 0) {
    variants = /* @__PURE__ */ new Map();
    paintedRenderLineCache.set(line5, variants);
  }
  const cached = variants.get(cacheKey);
  if (cached !== void 0) return cached;
  const painted = paintLineFromRenderLine(line5, hyperlinks2);
  variants.set(cacheKey, painted);
  return painted;
}
function areSlicedLinesBlockPropsEqual(prev, next) {
  return prev.lines === next.lines && prev.sliceStart === next.sliceStart && prev.sliceEnd === next.sliceEnd && prev.textRanges === next.textRanges && prev.tailRow === next.tailRow && prev.tail === next.tail && prev.prefix.first === next.prefix.first && prev.prefix.rest === next.prefix.rest;
}
var SlicedLinesBlock = memo(function SlicedLinesBlock2(props) {
  const { lines, sliceStart, sliceEnd, prefix, textRanges, tailRow, tail } = props;
  const end = Math.min(lines.length, Math.max(0, sliceEnd));
  const start = Math.max(0, Math.min(end, sliceStart));
  const effectiveTailRow = tailRow ?? lines.length - 1;
  const out = [];
  const hyperlinks2 = hyperlinksEnabled();
  const paintCacheKey = `${currentTier()}:${hyperlinks2 ? "links" : "plain"}`;
  for (let index = start; index < end; index += 1) {
    const line5 = lines.at(index);
    if (line5 === void 0) {
      continue;
    }
    const painted = cachedPaintedRenderLine(line5, paintCacheKey, hyperlinks2);
    const lead = slicedLead(prefix, textRanges, index);
    const trailing = index === effectiveTailRow ? tail : void 0;
    out.push(
      /* @__PURE__ */ jsxs5(Text6, { wrap: "truncate", children: [
        lead,
        painted,
        trailing
      ] }, index)
    );
  }
  if (out.length === 0) {
    return null;
  }
  return /* @__PURE__ */ jsx6(Box6, { flexDirection: "column", width: "100%", children: out });
}, areSlicedLinesBlockPropsEqual);
function projectBlockEntry(deps, ownerId, entry, scope, state, active) {
  if (entry.kind === "tool-card" && entry.meta?.toolCard !== void 0) {
    return { lines: deps.toolRows.rows(entry.id, entry.meta.toolCard, scope.width, scope.fold.tools, deps.locale) };
  }
  if (entry.kind === "reasoning" && entry.meta?.reasoningExpanded === true && entry.source !== "") {
    const rows = new RowSequence();
    const prefix = entry.meta.reasoningLive === true ? "" : "\u25BE ";
    const title = `\u273B ${tuiCopy("reasoning", deps.locale)}`;
    const duration = ` (${((entry.meta.reasoningDurationMs ?? 0) / 1e3).toFixed(1)}s)`;
    const header = `${prefix}${title}${duration}`;
    const prefixWidth = displayWidth(prefix);
    const titleWidth = displayWidth(title);
    const totalWidth = displayWidth(header);
    const spans = [
      ...prefixWidth > 0 ? [{ start: 0, end: prefixWidth, token: "accentText", bold: false }] : [],
      { start: prefixWidth, end: prefixWidth + titleWidth, token: "accentText", bold: false },
      { start: prefixWidth + titleWidth, end: totalWidth, token: "fgDim", bold: false }
    ];
    rows.push({
      ...GAP_LINE,
      text: header,
      displayWidth: totalWidth,
      spans,
      background: "toolBg",
      backgroundColumns: scope.width
    });
    rows.append(deps.plainRows.rows(entry.id, entry.source, Math.max(1, scope.width - 4), scope.width, "toolBg"));
    return { lines: rows.build() };
  }
  const projection = projectBlockRows(entry, scope, state);
  deps.storeBlocks.set(entry.id, {
    ownerId,
    entry,
    scope,
    lines: projection.lines,
    active
  });
  return projection;
}
function makeBlockProjector(deps, storeBlocks) {
  return (ownerId, entry, scope, state, active) => projectBlockEntry({ ...deps, storeBlocks }, ownerId, entry, scope, state, active);
}
function makeToolSummaryBlockEntry(id, summary, contentWidth) {
  return {
    id: `${id}-tool-summary`,
    kind: "tool-summary",
    source: toolSummaryText(summary, contentWidth),
    meta: { toolSummaryStatus: toolSummaryStatus(summary) }
  };
}
function makeToolCardBlockEntry(id, card) {
  return {
    id: `${id}-c-${card.callId}`,
    kind: "tool-card",
    source: "",
    meta: {
      toolCard: {
        name: card.name,
        arguments: card.arguments,
        status: card.status,
        ...card.resultText === void 0 ? {} : { resultText: card.resultText },
        ...card.meta === void 0 ? {} : { meta: card.meta },
        ...card.error === void 0 ? {} : { error: card.error },
        ...card.callView === void 0 ? {} : { callView: card.callView },
        ...card.resultView === void 0 ? {} : { resultView: card.resultView }
      }
    }
  };
}
function StreamView({
  model,
  presenters,
  brandTier = "plain",
  brandAnimation = false,
  scrollbar = true,
  brandFrameProbe,
  viewportCommand,
  renderPolicy,
  frameMetrics,
  motionPaused = false,
  mode = "agent",
  layoutKey,
  locale = "zh-CN"
}) {
  const policy = renderPolicy ?? renderPolicyDefaults();
  const toolRows = useMemo(() => new ToolRowCache(policy.tools), [
    policy.tools.previewRows,
    policy.tools.diffPreviewRows,
    policy.tools.cacheEntries,
    policy.tools.cacheRows
  ]);
  const presenterCache = useMemo(() => new ToolPresenterCache(policy.tools.cacheEntries), [policy.tools.cacheEntries]);
  const plainRows = useMemo(() => new PlainTextRowCache(policy.cache), [policy.cache.maxRows, policy.cache.maxBytes]);
  useEffect2(() => () => {
    plainRows.clear();
  }, [plainRows]);
  useEffect2(() => () => {
    presenterCache.clear();
  }, [presenterCache]);
  useEffect2(() => () => {
    toolRows.clear();
  }, [toolRows]);
  const transcriptOverscan = policy.transcriptOverscan;
  const { columns, rows } = useWindowSize4();
  const { stdout } = useStdout();
  const physicalViewport = stdout.isTTY;
  const contentWidth = conversationWidth(columns);
  const contentLeft = conversationLeft(columns, contentWidth);
  const viewportRef = useRef3(null);
  const blockRefs = useRef3(/* @__PURE__ */ new Map());
  const layoutCache = useRef3(new TranscriptLayoutCache());
  const projectorStates = useRef3(/* @__PURE__ */ new Map());
  const rebuildBlocks = useRef3(/* @__PURE__ */ new Map());
  const lineStore = useRef3(void 0);
  if (lineStore.current === void 0) {
    lineStore.current = createTranscriptRenderStore({
      maxRows: policy.cache.maxRows,
      maxBytes: policy.cache.maxBytes,
      rebuild: ({ blockId }) => {
        const descriptor = rebuildBlocks.current.get(blockId);
        if (descriptor === void 0) {
          throw new Error(`TranscriptRenderStore: missing source descriptor for ${blockId}`);
        }
        const state = descriptor.entry.kind === "markdown" || descriptor.entry.kind === "assistant-prose" ? createMarkdownProjectorState(blockId, descriptor.scope) : void 0;
        return projectBlockRows(descriptor.entry, descriptor.scope, state).lines.map((line5) => markdownLineToPhysicalLine(blockId, line5));
      }
    });
  }
  const lastCommandSequence = useRef3(-1);
  const layoutRevision = 0;
  const [viewport, dispatchViewport] = useReducer(
    reduceTranscriptViewport,
    EMPTY_TRANSCRIPT_VIEWPORT
  );
  const [measuredGeometry, setMeasuredGeometry] = useState2();
  const geometryMeasured = measuredGeometry !== void 0 && measuredGeometry.columns === columns && measuredGeometry.rows === rows && measuredGeometry.key === layoutKey;
  const scrollScheduler = useRef3(void 0);
  const presentationQueue = useRef3(void 0);
  const frameArbiter = useRef3(void 0);
  const pendingScrollInputAt = useRef3(void 0);
  const lastDispatchedOffset = useRef3(viewport.offsetFromBottom);
  useLayoutEffect(() => {
    const scroll = createScrollScheduler({
      frameIntervalMs: policy.scroll.frameIntervalMs,
      stepPerFrame: policy.scroll.stepPerFrame,
      catchUpThreshold: policy.scroll.catchUpThreshold,
      maxCatchUpStep: policy.scroll.maxCatchUpStep,
      initialPosition: viewport.offsetFromBottom,
      autoSchedule: false
    });
    const stream = createStreamQueue({
      frameIntervalMs: policy.stream.frameIntervalMs,
      entryDepth: policy.stream.entryDepth,
      exitDepth: policy.stream.exitDepth,
      maxOldestAgeMs: policy.stream.entryOldestAgeMs,
      exitOldestAgeMs: policy.stream.exitOldestAgeMs,
      drainBackpressureMs: policy.stream.entryDrainBackpressureMs,
      exitDrainBackpressureMs: policy.stream.exitDrainBackpressureMs,
      catchUpRowsPerFrame: policy.stream.catchUpRowsPerFrame,
      maxDepth: policy.stream.entryDepth + policy.stream.catchUpRowsPerFrame
    });
    const arbiter = createFrameArbiter({
      frameIntervalMs: Math.min(
        policy.scroll.frameIntervalMs,
        policy.stream.frameIntervalMs
      ),
      scroll,
      stream,
      drivesScrollScheduler: true,
      now: () => performance.now(),
      demandDriven: true
    });
    const unsubscribe = arbiter.onPublish((snapshot) => {
      const presented = snapshot.stream.at(-1);
      if (presented !== void 0) setPresentedEntryRows(presented);
      if (snapshot.scroll.presented !== lastDispatchedOffset.current) {
        lastDispatchedOffset.current = snapshot.scroll.presented;
        dispatchViewport({
          kind: "offset",
          offsetFromBottom: snapshot.scroll.presented
        });
      }
      if (pendingScrollInputAt.current !== void 0 && frameMetrics !== void 0) {
        frameMetrics.recordScrollInputToPaint(
          Math.max(0, performance.now() - pendingScrollInputAt.current)
        );
        pendingScrollInputAt.current = void 0;
      }
      if (frameMetrics !== void 0) {
        const queue = stream.getStats(snapshot.nowMs);
        frameMetrics.recordRenderQueue(queue.depth, queue.oldestAgeMs);
      }
    });
    scrollScheduler.current = scroll;
    presentationQueue.current = stream;
    frameArbiter.current = arbiter;
    return () => {
      unsubscribe();
      arbiter.dispose();
      if (scrollScheduler.current === scroll) scrollScheduler.current = void 0;
      if (presentationQueue.current === stream) presentationQueue.current = void 0;
      if (frameArbiter.current === arbiter) frameArbiter.current = void 0;
    };
  }, [
    frameMetrics,
    policy.scroll.catchUpThreshold,
    policy.scroll.frameIntervalMs,
    policy.scroll.maxCatchUpStep,
    policy.scroll.stepPerFrame,
    policy.stream.catchUpRowsPerFrame,
    policy.stream.entryDepth,
    policy.stream.entryDrainBackpressureMs,
    policy.stream.entryOldestAgeMs,
    policy.stream.exitDepth,
    policy.stream.exitDrainBackpressureMs,
    policy.stream.exitOldestAgeMs
  ]);
  const {
    history,
    compactionDividers = EMPTY_COMPACTION_DIVIDERS,
    expandedCompactionId,
    activeTurn,
    status,
    reasoningExpanded,
    toolCardsExpanded
  } = model;
  const liveDurationMs = useLiveDuration(liveDurationTarget(activeTurn, status));
  const revisions = useRef3(new DisplayRevisionIndex()).current;
  const compactionVersion = compactionDividers.map((divider) => revisions.revision(divider)).join("\0");
  const transcript = useMemo(() => [
    ...history.map((message) => ({ kind: "message", id: message.id, message })),
    ...compactionDividers.map((divider) => ({
      kind: "compaction",
      id: divider.id,
      divider
    }))
  ].sort((left, right) => left.id - right.id), [
    compactionDividers,
    compactionDividers.length,
    compactionVersion,
    history,
    history.length
  ]);
  const activeVersion = activeTurn === void 0 ? "" : activeTurnVersion(activeTurn, revisions);
  useLayoutEffect(() => {
    if (frameMetrics !== void 0 && activeTurn !== void 0) {
      markDeltaIngress(frameMetrics);
    }
  }, [activeTurn, activeVersion, frameMetrics]);
  const themeTier = currentTier();
  const blockRowsScope = useMemo(() => {
    const theme = themeTier === "truecolor" || themeTier === "256" || themeTier === "16" ? themeTier : "none";
    const renderMode = status === "generating" ? "streaming" : "settled";
    return {
      width: contentWidth,
      theme,
      fold: {
        reasoning: reasoningExpanded,
        tools: toolCardsExpanded
      },
      renderMode,
      scopeKey: computeBlockRowsScopeKey(
        contentWidth,
        theme,
        { reasoning: reasoningExpanded, tools: toolCardsExpanded },
        renderMode
      )
    };
  }, [
    contentWidth,
    reasoningExpanded,
    status,
    themeTier,
    toolCardsExpanded
  ]);
  const settledBlockRowsScope = useMemo(() => ({
    ...blockRowsScope,
    renderMode: "settled",
    scopeKey: computeBlockRowsScopeKey(
      blockRowsScope.width,
      blockRowsScope.theme,
      blockRowsScope.fold,
      "settled"
    )
  }), [blockRowsScope]);
  const assistantBlockRowsScope = useMemo(
    () => assistantProseScope(blockRowsScope),
    [blockRowsScope]
  );
  const settledAssistantBlockRowsScope = useMemo(
    () => assistantProseScope(settledBlockRowsScope),
    [settledBlockRowsScope]
  );
  const hasActiveTurn = activeTurn !== void 0;
  const settledEntryRows = useMemo(() => {
    const definitions = /* @__PURE__ */ new Map();
    const batchPresenters = presenters === void 0 ? void 0 : { get(name) {
      if (!definitions.has(name)) definitions.set(name, presenters.get(name));
      return definitions.get(name);
    } };
    const map = /* @__PURE__ */ new Map();
    const textRanges = /* @__PURE__ */ new Map();
    const storeBlocks = /* @__PURE__ */ new Map();
    const projectorCache = projectorStates.current;
    const project = makeBlockProjector({ toolRows, plainRows, locale }, storeBlocks);
    const latestAssistant = hasActiveTurn ? void 0 : latestAssistantId(history, void 0);
    for (const [index, row] of transcript.entries()) {
      const id = transcriptBlockId(row);
      if (row.kind === "compaction") {
        const meta = {
          compactionSummary: row.divider.summary,
          compactionExpanded: expandedCompactionId === row.divider.compactionId,
          ...row.divider.shadowedCount === void 0 ? {} : { compactionShadowedCount: row.divider.shadowedCount }
        };
        const projection = project(id, {
          id,
          kind: "compaction",
          source: row.divider.compactionId,
          meta
        }, settledBlockRowsScope, void 0, false);
        map.set(id, projection.lines);
        continue;
      }
      if (row.message.kind === "user") {
        const hasSubsequent = index < transcript.length - 1 || hasActiveTurn;
        const projection = project(id, {
          id,
          kind: "user",
          source: row.message.text,
          ...hasSubsequent ? { meta: { userMessageGap: true } } : {}
        }, settledBlockRowsScope, void 0, false);
        map.set(id, projection.lines);
        continue;
      }
      const parts = displayedParts(
        compactToolParts(partsFromFrozen(row.message), toolCardsExpanded, batchPresenters, mode, presenterCache),
        reasoningExpanded
      );
      const rows2 = new RowSequence();
      const ranges = [];
      let textIndex = 0;
      for (const [partIndex, part] of parts.entries()) {
        if (turnPartGap(parts, partIndex) > 0) rows2.push(GAP_LINE);
        if (part.kind === "reasoning") {
          rows2.append(project(id, {
            id: `${id}-r-${String(partIndex)}`,
            kind: "reasoning",
            source: part.text,
            meta: {
              reasoningDurationMs: part.durationMs,
              reasoningExpanded,
              reasoningLive: false
            }
          }, settledBlockRowsScope, void 0, false).lines);
          continue;
        }
        if (part.kind === "tool-summary") {
          rows2.append(project(
            id,
            makeToolSummaryBlockEntry(id, part.summary, contentWidth),
            settledBlockRowsScope,
            void 0,
            false
          ).lines);
          continue;
        }
        if (part.kind === "card") {
          rows2.append(project(
            id,
            makeToolCardBlockEntry(id, part.card),
            settledBlockRowsScope,
            void 0,
            false
          ).lines);
          continue;
        }
        const start = rows2.length;
        const partId = `${id}-t-${String(textIndex++)}`;
        rows2.append(project(id, {
          id: partId,
          kind: "assistant-prose",
          source: part.text
        }, settledAssistantBlockRowsScope, projectorStateFor(
          projectorCache,
          partId,
          settledAssistantBlockRowsScope,
          row.message.turnOrdinal === void 0 ? [] : [`assistant-turn-${String(row.message.turnOrdinal)}-t-${String(textIndex - 1)}`],
          part.text
        ), false).lines);
        ranges.push({ start, end: rows2.length });
      }
      const tailMeta = {
        ...latestAssistant === row.message.id ? { turnTailCompletionBoundary: true } : {},
        ...(() => {
          const stats = formatTurnTailStats({
            turnOrdinal: row.message.turnOrdinal,
            turnUsage: row.message.turnUsage,
            legacyOutputTokens: row.message.usageOutputTokens,
            elapsedMs: row.message.stepWallMs
          });
          return stats === void 0 ? {} : { turnTailStats: stats };
        })(),
        ...(() => {
          const cards = cardsFrom(row.message.content ?? []).map(
            (card) => presenterCache.present(batchPresenters, card)
          );
          const produced = producedPathsForTurn(cards);
          return produced.length === 0 ? {} : { turnTailProduced: produced };
        })()
      };
      if (Object.keys(tailMeta).length > 0) {
        rows2.push(GAP_LINE);
        rows2.append(project(id, {
          id: `${id}-tail`,
          kind: "turn-tail",
          source: "",
          meta: tailMeta
        }, settledBlockRowsScope, void 0, false).lines);
      }
      map.set(id, rows2.build());
      if (ranges.length > 0) textRanges.set(id, ranges);
    }
    return { rows: map, textRanges, storeBlocks };
  }, [
    contentWidth,
    expandedCompactionId,
    hasActiveTurn,
    history,
    locale,
    mode,
    plainRows,
    presenterCache,
    presenters,
    reasoningExpanded,
    settledAssistantBlockRowsScope,
    settledBlockRowsScope,
    toolCardsExpanded,
    toolRows,
    transcript
  ]);
  const activeTurnRows = useMemo(() => {
    if (activeTurn === void 0) return void 0;
    const definitions = /* @__PURE__ */ new Map();
    const batchPresenters = presenters === void 0 ? void 0 : { get(name) {
      if (!definitions.has(name)) definitions.set(name, presenters.get(name));
      return definitions.get(name);
    } };
    const storeBlocks = /* @__PURE__ */ new Map();
    const projectorCache = projectorStates.current;
    const project = makeBlockProjector({ toolRows, plainRows, locale }, storeBlocks);
    const id = `assistant-turn-${String(activeTurn.turn)}`;
    const rawParts = partsFromTurn(activeTurn);
    const visibleParts = displayedParts(rawParts, reasoningExpanded);
    if (status === "generating" && visibleParts.length === 0) {
      const liveMs = liveDurationMs ?? activeTurn.reasoningDurationMs;
      const spinner = getBrailleSpinnerFrame(liveMs);
      const label = rawParts.some((p) => p.kind === "reasoning") ? tuiCopy("thinking", locale) : tuiCopy("processing", locale);
      const lines = project(id, {
        id,
        kind: "active-placeholder",
        source: "",
        meta: {
          activePlaceholder: `${spinner} \u25CF ${label} (${formatSeconds(
            liveMs
          )}s)`
        }
      }, blockRowsScope, void 0, true).lines;
      return { id, lines, ranges: [], storeBlocks };
    }
    const parts = displayedParts(
      compactToolParts(rawParts, toolCardsExpanded, batchPresenters, mode, presenterCache),
      reasoningExpanded
    );
    const rows2 = new RowSequence();
    const ranges = [];
    let textIndex = 0;
    let lastVisiblePart = -1;
    for (const [partIndex, part] of parts.entries()) {
      if (isVisiblePart(part)) lastVisiblePart = partIndex;
    }
    for (const [partIndex, part] of parts.entries()) {
      if (turnPartGap(parts, partIndex) > 0) rows2.push(GAP_LINE);
      if (part.kind === "reasoning") {
        const live = status === "generating" && partIndex === lastVisiblePart;
        rows2.append(project(id, {
          id: `${id}-r-${String(partIndex)}`,
          kind: "reasoning",
          source: part.text,
          meta: {
            reasoningDurationMs: live ? liveDurationMs ?? part.durationMs : part.durationMs,
            reasoningExpanded,
            reasoningLive: live
          }
        }, blockRowsScope, void 0, status === "generating").lines);
        continue;
      }
      if (part.kind === "tool-summary") {
        rows2.append(project(
          id,
          makeToolSummaryBlockEntry(id, part.summary, contentWidth),
          blockRowsScope,
          void 0,
          status === "generating"
        ).lines);
        continue;
      }
      if (part.kind === "card") {
        rows2.append(project(
          id,
          makeToolCardBlockEntry(id, part.card),
          blockRowsScope,
          void 0,
          status === "generating"
        ).lines);
        continue;
      }
      const start = rows2.length;
      const partId = `${id}-t-${String(textIndex++)}`;
      rows2.append(project(id, {
        id: partId,
        kind: "assistant-prose",
        source: part.text
      }, assistantBlockRowsScope, projectorStateFor(
        projectorCache,
        partId,
        assistantBlockRowsScope
      ), status === "generating").lines);
      ranges.push({ start, end: rows2.length });
    }
    if (status === "generating") {
      const lastRaw = rawParts[rawParts.length - 1];
      const lastVisible = parts[parts.length - 1];
      const isReasoningActive = lastRaw?.kind === "reasoning";
      const isToolCompleted = lastVisible?.kind === "card" && lastVisible.card.status !== "running" || lastVisible?.kind === "tool-summary" && lastVisible.summary.runningCount === 0;
      if (isReasoningActive && !reasoningExpanded || isToolCompleted) {
        const liveMs = liveDurationMs ?? activeTurn.reasoningDurationMs;
        const spinner = getBrailleSpinnerFrame(liveMs);
        const label = isReasoningActive ? tuiCopy("thinking", locale) : tuiCopy("processing", locale);
        rows2.push(GAP_LINE);
        rows2.append(project(id, {
          id: `${id}-tail-placeholder`,
          kind: "active-placeholder",
          source: "",
          meta: {
            activePlaceholder: `${spinner} \u25CF ${label} (${formatSeconds(liveMs)}s)`
          }
        }, blockRowsScope, void 0, true).lines);
      }
    }
    return { id, lines: rows2.build(), ranges, storeBlocks };
  }, [
    activeTurn,
    activeVersion,
    assistantBlockRowsScope,
    blockRowsScope,
    contentWidth,
    liveDurationMs,
    locale,
    mode,
    plainRows,
    presenterCache,
    presenters,
    reasoningExpanded,
    status,
    toolCardsExpanded,
    toolRows
  ]);
  const entryRows = useMemo(() => {
    if (activeTurnRows === void 0) return settledEntryRows;
    const map = new Map(settledEntryRows.rows);
    map.set(activeTurnRows.id, activeTurnRows.lines);
    const textRanges = new Map(settledEntryRows.textRanges);
    if (activeTurnRows.ranges.length > 0) {
      textRanges.set(activeTurnRows.id, activeTurnRows.ranges);
    }
    const storeBlocks = new Map(settledEntryRows.storeBlocks);
    for (const [key, val] of activeTurnRows.storeBlocks) {
      storeBlocks.set(key, val);
    }
    return { rows: map, textRanges, storeBlocks };
  }, [settledEntryRows, activeTurnRows]);
  const [presentedEntryRows, setPresentedEntryRows] = useState2(entryRows);
  const activeEntryRows = status === "generating" ? presentedEntryRows : entryRows;
  useLayoutEffect(() => {
    const queue = presentationQueue.current;
    const arbiter = frameArbiter.current;
    if (queue === void 0 || arbiter === void 0) {
      setPresentedEntryRows(entryRows);
      return;
    }
    if (status !== "generating") {
      queue.flush();
      setPresentedEntryRows(entryRows);
      if (frameMetrics !== void 0) frameMetrics.recordRenderQueue(0, 0);
      return;
    }
    const now = performance.now();
    if (frameMetrics !== void 0) {
      queue.noteDrain(frameMetrics.snapshot().deltaIngressToStdoutDrainMs.max);
    }
    queue.flush();
    queue.push([entryRows], now);
    const stats = queue.getStats(now);
    frameMetrics?.recordRenderQueue(stats.depth, stats.oldestAgeMs);
    arbiter.requestStream();
  }, [entryRows, frameMetrics, status]);
  const activeLineRevisions = useRef3(/* @__PURE__ */ new Map());
  const storedLineSignatures = useRef3(/* @__PURE__ */ new Map());
  const lineRevisionOwners = useRef3(/* @__PURE__ */ new Map());
  const physicalLineCache = useRef3(/* @__PURE__ */ new WeakMap());
  const lastLineStoreMetrics = useRef3({ bytes: 0, evictions: 0 });
  useEffect2(() => () => {
    for (const active of activeLineRevisions.current.values()) {
      active.handle.settle();
    }
    activeLineRevisions.current.clear();
    lineStore.current?.clearPins();
  }, []);
  useLayoutEffect(() => {
    const store = lineStore.current;
    if (store === void 0) return;
    const currentActive = /* @__PURE__ */ new Set();
    for (const descriptor of entryRows.storeBlocks.values()) {
      rebuildBlocks.current.set(descriptor.entry.id, descriptor);
      let revisionOwner = lineRevisionOwners.current.get(descriptor.entry.id);
      if (revisionOwner === void 0) {
        revisionOwner = {};
        lineRevisionOwners.current.set(descriptor.entry.id, revisionOwner);
      }
      const signature = revisions.revision(revisionOwner, [
        descriptor.scope.scopeKey,
        descriptor.entry.source,
        JSON.stringify(descriptor.entry.meta ?? {}),
        String(descriptor.lines.length)
      ]);
      if (!descriptor.active && !activeLineRevisions.current.has(descriptor.entry.id) && storedLineSignatures.current.get(descriptor.entry.id) === signature) continue;
      const physical = descriptor.lines.map((line5) => {
        let byBlock = physicalLineCache.current.get(line5);
        if (byBlock === void 0) {
          byBlock = /* @__PURE__ */ new Map();
          physicalLineCache.current.set(line5, byBlock);
        }
        let cached = byBlock.get(descriptor.entry.id);
        if (cached === void 0) {
          cached = markdownLineToPhysicalLine(descriptor.entry.id, line5);
          byBlock.set(descriptor.entry.id, cached);
        }
        return cached;
      });
      const active = activeLineRevisions.current.get(descriptor.entry.id);
      if (descriptor.active) {
        currentActive.add(descriptor.entry.id);
        if (active !== void 0 && active.scopeKey === descriptor.scope.scopeKey) {
          if (active.signature !== signature) {
            active.handle.replace({ source: descriptor.entry.source, lines: physical });
            active.signature = signature;
          }
          continue;
        }
        if (active !== void 0) {
          active.handle.settle();
          activeLineRevisions.current.delete(descriptor.entry.id);
        }
        const handle2 = store.acquireActive({
          blockId: descriptor.entry.id,
          source: descriptor.entry.source,
          scopeKey: descriptor.scope.scopeKey
        });
        handle2.replace({ source: descriptor.entry.source, lines: physical });
        activeLineRevisions.current.set(descriptor.entry.id, {
          handle: handle2,
          signature,
          scopeKey: descriptor.scope.scopeKey
        });
        continue;
      }
      if (active !== void 0) {
        active.handle.settle();
        activeLineRevisions.current.delete(descriptor.entry.id);
      }
      if (storedLineSignatures.current.get(descriptor.entry.id) === signature) continue;
      store.upsertSource({
        blockId: descriptor.entry.id,
        source: descriptor.entry.source,
        scopeKey: descriptor.scope.scopeKey
      });
      const handle = store.acquireActive({
        blockId: descriptor.entry.id,
        source: descriptor.entry.source,
        scopeKey: descriptor.scope.scopeKey
      });
      handle.replace({ source: descriptor.entry.source, lines: physical });
      handle.settle();
      storedLineSignatures.current.set(descriptor.entry.id, signature);
    }
    for (const [blockId, active] of activeLineRevisions.current) {
      if (currentActive.has(blockId)) continue;
      active.handle.settle();
      activeLineRevisions.current.delete(blockId);
    }
    const stats = store.stats();
    if (frameMetrics !== void 0) {
      frameMetrics.addCacheBytes(stats.cachedBytes - lastLineStoreMetrics.current.bytes);
      frameMetrics.addCacheEvictions(Math.max(
        0,
        stats.evictions - lastLineStoreMetrics.current.evictions
      ));
    }
    lastLineStoreMetrics.current = {
      bytes: stats.cachedBytes,
      evictions: stats.evictions
    };
  }, [entryRows, frameMetrics]);
  const lastProjectorMetrics = useRef3({
    parsedBytes: 0,
    stableRowsReused: 0,
    tailRowsRerendered: 0,
    cacheEvictions: 0
  });
  useLayoutEffect(() => {
    if (frameMetrics === void 0) return;
    const totals = {
      parsedBytes: 0,
      stableRowsReused: 0,
      tailRowsRerendered: 0,
      cacheEvictions: 0
    };
    for (const state of projectorStates.current.values()) {
      const stats = state.stats();
      totals.parsedBytes += stats.parsedBytes;
      totals.stableRowsReused += stats.stableRowsReused;
      totals.tailRowsRerendered += stats.tailLinesPainted;
      totals.cacheEvictions += stats.cacheEvictions;
    }
    const previous = lastProjectorMetrics.current;
    frameMetrics.addMarkdownParseBytes(Math.max(0, totals.parsedBytes - previous.parsedBytes));
    frameMetrics.addStableRowsReused(Math.max(
      0,
      totals.stableRowsReused - previous.stableRowsReused
    ));
    frameMetrics.addTailRowsRerendered(Math.max(
      0,
      totals.tailRowsRerendered - previous.tailRowsRerendered
    ));
    frameMetrics.addCacheEvictions(Math.max(
      0,
      totals.cacheEvictions - previous.cacheEvictions
    ));
    lastProjectorMetrics.current = totals;
  }, [entryRows, frameMetrics]);
  const settledRenderEntries = useMemo(() => transcript.flatMap((row, index) => {
    const hasSubsequent = index < transcript.length - 1 || hasActiveTurn;
    const isUserWithGap = row.kind === "message" && row.message.kind === "user" && hasSubsequent;
    const gapRows = isUserWithGap ? 0 : hasSubsequent ? 2 : 0;
    const id = transcriptBlockId(row);
    const lines = settledEntryRows.rows.get(id) ?? [];
    return [{
      kind: "row",
      id,
      version: `${transcriptBlockVersion(row, revisions)}\0${hasSubsequent ? "gap" : "tail"}`,
      gapRows,
      estimatedRows: lines.length + gapRows,
      lines,
      row
    }];
  }), [hasActiveTurn, revisions, settledEntryRows, transcript]);
  const renderEntries = useMemo(() => [
    ...settledRenderEntries.filter((entry) => activeTurn === void 0 || entry.id !== `assistant-turn-${String(activeTurn.turn)}`),
    ...activeTurn === void 0 ? [] : [{
      kind: "active",
      id: `assistant-turn-${String(activeTurn.turn)}`,
      version: activeVersion,
      gapRows: 0,
      estimatedRows: activeEntryRows.rows.get(`assistant-turn-${String(activeTurn.turn)}`)?.length ?? 0,
      lines: activeEntryRows.rows.get(`assistant-turn-${String(activeTurn.turn)}`) ?? [],
      turn: activeTurn
    }]
  ], [
    activeTurn,
    activeVersion,
    activeEntryRows,
    settledRenderEntries
  ]);
  const layoutScope = [
    contentWidth,
    currentTier(),
    reasoningExpanded ? "reasoning-open" : "reasoning-closed",
    mode === "focus" ? "tools-focus" : toolCardsExpanded ? "tools-open" : "tools-closed",
    expandedCompactionId ?? ""
  ].join(":");
  const layoutInputs = useMemo(
    () => renderEntries.map(({ id, version, estimatedRows }) => ({
      id,
      version,
      estimatedRows
    })),
    [renderEntries]
  );
  const contentRevision = renderEntries.length === 0 ? "empty" : `${String(renderEntries.length)}:${renderEntries.at(-1)?.id ?? ""}:${renderEntries.at(-1)?.version ?? ""}`;
  const lastContentRevision = useRef3(contentRevision);
  const virtualLayouts = useMemo(
    () => layoutCache.current.layouts(layoutScope, layoutInputs),
    [layoutInputs, layoutRevision, layoutScope]
  );
  const virtualContentRows = virtualLayouts.at(-1) === void 0 ? 0 : virtualLayouts.at(-1).top + virtualLayouts.at(-1).rows;
  const effectiveViewportRows = viewport.viewportRows > 0 ? viewport.viewportRows : Math.max(1, rows - 7);
  const effectiveOffset = viewport.follow ? 0 : Math.min(
    viewport.offsetFromBottom,
    Math.max(0, virtualContentRows - effectiveViewportRows)
  );
  const visibleTop = Math.max(
    0,
    virtualContentRows - effectiveViewportRows - effectiveOffset
  );
  const visibleBottom = visibleTop + effectiveViewportRows;
  const configuredOverscanRows = Math.max(
    0,
    Math.min(
      effectiveViewportRows,
      Math.max(0, transcriptOverscan)
    )
  );
  const overscanRows = configuredOverscanRows;
  const overscanTop = Math.max(0, visibleTop - overscanRows);
  const overscanBottom = Math.min(
    virtualContentRows,
    visibleBottom + overscanRows
  );
  const visibleIndexes = useMemo(
    () => physicalViewport ? intersectingLayoutIndexes(virtualLayouts, overscanTop, overscanBottom) : renderEntries.map((_entry, index) => index),
    [overscanBottom, overscanTop, physicalViewport, renderEntries, virtualLayouts]
  );
  const firstVisibleIndex = visibleIndexes[0];
  const lastVisibleIndex = visibleIndexes.at(-1);
  const leadingRows = firstVisibleIndex === void 0 ? 0 : virtualLayouts[firstVisibleIndex]?.top ?? 0;
  const lastVisibleLayout = lastVisibleIndex === void 0 ? void 0 : virtualLayouts[lastVisibleIndex];
  const trailingRows = lastVisibleLayout === void 0 ? 0 : Math.max(
    0,
    virtualContentRows - lastVisibleLayout.top - lastVisibleLayout.rows
  );
  const visibleEntryPairs = useMemo(
    () => visibleIndexes.flatMap((index) => {
      const entry = renderEntries[index];
      return entry === void 0 ? [] : [{ index, entry }];
    }),
    [renderEntries, visibleIndexes]
  );
  const visibleEntries = useMemo(
    () => visibleEntryPairs.map((pair) => pair.entry),
    [visibleEntryPairs]
  );
  const pinIndex = useMemo(() => {
    const byOwner = /* @__PURE__ */ new Map();
    const active = [];
    for (const descriptor of entryRows.storeBlocks.values()) {
      let blockIds = byOwner.get(descriptor.ownerId);
      if (blockIds === void 0) {
        blockIds = [];
        byOwner.set(descriptor.ownerId, blockIds);
      }
      blockIds.push(descriptor.entry.id);
      if (descriptor.active) active.push(descriptor.entry.id);
    }
    return { byOwner, active };
  }, [entryRows]);
  useLayoutEffect(() => {
    const store = lineStore.current;
    if (store === void 0) return;
    const owners = new Set(visibleEntries.map((entry) => entry.id));
    if (viewport.anchor !== void 0) owners.add(viewport.anchor.blockId);
    const pinned = [...pinIndex.active];
    for (const ownerId of owners) {
      pinned.push(...pinIndex.byOwner.get(ownerId) ?? []);
    }
    store.setPins({ pinned });
  }, [pinIndex, viewport.anchor, visibleEntries]);
  const idleHome = transcript.length === 0 && activeTurn === void 0;
  const generating = status === "generating";
  const latestSettledAssistantId = activeTurn === void 0 ? history.findLast((message) => message.kind === "assistant")?.id : void 0;
  const viewportStateRef = useRef3(viewport);
  viewportStateRef.current = viewport;
  const virtualContentRowsRef = useRef3(virtualContentRows);
  virtualContentRowsRef.current = virtualContentRows;
  const effectiveViewportRowsRef = useRef3(effectiveViewportRows);
  effectiveViewportRowsRef.current = effectiveViewportRows;
  const executeViewportCommand = useCallback((command) => {
    if (command.sequence === lastCommandSequence.current) return;
    const vp = viewportStateRef.current;
    if (command.kind !== "reset" && (vp.viewportRows === 0 || vp.contentRows === 0)) return;
    lastCommandSequence.current = command.sequence;
    const scheduler = scrollScheduler.current;
    const arbiter = frameArbiter.current;
    if (scheduler === void 0 || arbiter === void 0) return;
    const effectiveContentRows = Math.max(vp.contentRows, virtualContentRowsRef.current);
    const maximum = Math.max(0, effectiveContentRows - effectiveViewportRowsRef.current);
    const clamp = (value) => Math.max(0, Math.min(maximum, value));
    const advance = (delta) => {
      const presented = scheduler.getPresented();
      const target = scheduler.getTarget();
      const reversing = delta * (target - presented) < 0;
      scheduler.setTarget(clamp((reversing ? presented : target) + delta));
      scheduler.tick();
    };
    if (pendingScrollInputAt.current !== void 0) frameMetrics?.recordCoalescedInput();
    pendingScrollInputAt.current ??= performance.now();
    switch (command.kind) {
      case "scroll":
        advance(command.delta);
        break;
      case "page":
        advance(command.delta * Math.max(1, vp.viewportRows - 1));
        break;
      case "position":
        scheduler.snapTo(clamp(Math.round(
          maximum * (1 - Math.max(0, Math.min(1, command.fraction)))
        )));
        break;
      case "edge":
        scheduler.snapTo(command.edge === "latest" ? 0 : maximum);
        break;
      case "reset":
        scheduler.snapTo(0);
        lastDispatchedOffset.current = 0;
        pendingScrollInputAt.current = void 0;
        dispatchViewport({ kind: "reset" });
        return;
    }
    const presentedOffset = scheduler.getPresented();
    lastDispatchedOffset.current = presentedOffset;
    dispatchViewport({
      kind: "offset",
      offsetFromBottom: presentedOffset
    });
    arbiter.requestScroll();
  }, [frameMetrics]);
  useLayoutEffect(() => {
    if (viewportCommand === void 0) return;
    if (viewportCommand.sequence === lastCommandSequence.current) return;
    executeViewportCommand(viewportCommand);
  }, [
    viewportCommand,
    executeViewportCommand,
    viewport.contentRows,
    viewport.viewportRows,
    effectiveViewportRows,
    virtualContentRows
  ]);
  useLayoutEffect(() => {
    const scheduler = scrollScheduler.current;
    if (scheduler === void 0) return;
    const effectiveContentRows = Math.max(viewport.contentRows, virtualContentRows);
    const maximum = Math.max(0, effectiveContentRows - effectiveViewportRows);
    const presented = scheduler.getPresented();
    if (presented === viewport.offsetFromBottom) return;
    if (scheduler.isAnimating()) {
      scheduler.rebase(viewport.offsetFromBottom - presented, maximum);
    } else {
      scheduler.snapTo(Math.max(0, Math.min(maximum, viewport.offsetFromBottom)));
    }
    lastDispatchedOffset.current = viewport.offsetFromBottom;
  }, [
    effectiveViewportRows,
    viewport.contentRows,
    viewport.offsetFromBottom,
    virtualContentRows
  ]);
  useLayoutEffect(() => {
    scrollScheduler.current?.snapTo(viewport.offsetFromBottom);
    lastDispatchedOffset.current = viewport.offsetFromBottom;
  }, [columns, rows]);
  useLayoutEffect(() => {
    if (!motionPaused) return;
    const scheduler = scrollScheduler.current;
    if (scheduler === void 0) return;
    scheduler.snapTo(viewport.offsetFromBottom);
    lastDispatchedOffset.current = viewport.offsetFromBottom;
  }, [motionPaused, viewport.offsetFromBottom]);
  useLayoutEffect(() => {
    const viewportElement = viewportRef.current;
    if (viewportElement === null) return;
    const viewportBox = measureElement(viewportElement);
    setMeasuredGeometry((previous) => previous?.columns === columns && previous.rows === rows && previous.height === viewportBox.height && previous.key === layoutKey ? previous : { columns, rows, height: viewportBox.height, key: layoutKey });
    const layouts = layoutCache.current.layouts(layoutScope, layoutInputs);
    const contentRows = layouts.at(-1) === void 0 ? 0 : layouts.at(-1).top + layouts.at(-1).rows;
    const contentChanged = contentRevision !== lastContentRevision.current;
    lastContentRevision.current = contentRevision;
    if (contentChanged || viewport.viewportRows !== viewportBox.height || viewport.contentRows !== contentRows) {
      dispatchViewport({
        kind: "layout",
        contentRows,
        viewportRows: viewportBox.height,
        blocks: layouts,
        unseenRowsAdded: contentChanged ? Math.max(0, contentRows - viewport.contentRows) : 0
      });
    }
  }, [
    columns,
    contentRevision,
    layoutInputs,
    layoutKey,
    layoutScope,
    rows,
    viewport.contentRows,
    viewport.viewportRows
  ]);
  useLayoutEffect(() => {
    if (frameMetrics === void 0) return;
    let mounted = 0;
    for (const layoutIndex of visibleIndexes) {
      const entry = renderEntries[layoutIndex];
      if (entry === void 0) continue;
      const layout = virtualLayouts[layoutIndex];
      if (layout === void 0) {
        continue;
      }
      let window;
      if (physicalViewport) {
        window = sliceWindow(
          entry.lines.length,
          layout.top,
          overscanTop,
          overscanBottom
        );
      }
      mounted += window === void 0 ? entry.lines.length : Math.max(0, window.end - window.start);
    }
    frameMetrics.addMountedRows(mounted);
  }, [
    frameMetrics,
    overscanBottom,
    overscanTop,
    physicalViewport,
    renderEntries,
    virtualLayouts,
    visibleIndexes
  ]);
  const rail = scrollbar ? physicalScrollRailGeometry(
    viewport.contentRows,
    viewport.viewportRows,
    viewport.offsetFromBottom
  ) : void 0;
  const publishedRail = physicalViewport && rail !== void 0 ? {
    col: columns,
    topRow: 3,
    rows: rail.rows,
    thumbStart: rail.thumbStart,
    thumbRows: rail.thumbRows
  } : void 0;
  const visibleFrame = useMemo(() => {
    const snapshotRows = [];
    const verticalBase = Math.max(0, effectiveViewportRows - virtualContentRows);
    for (const { entry, index: layoutIndex } of visibleEntryPairs) {
      const layout = virtualLayouts[layoutIndex];
      if (layout === void 0) continue;
      const start = Math.max(0, Math.floor(visibleTop - layout.top));
      const end = Math.min(entry.lines.length, Math.ceil(visibleBottom - layout.top));
      const assistant = entry.kind === "active" || entry.row.kind === "message" && entry.row.message.kind === "assistant";
      const ranges = assistant ? activeEntryRows.textRanges.get(entry.id) ?? EMPTY_TEXT_RANGES : EMPTY_TEXT_RANGES;
      for (let index = start; index < end; index += 1) {
        const line5 = entry.lines.at(index);
        if (line5 === void 0) continue;
        const absoluteRow = 3 + verticalBase + layout.top + index - visibleTop;
        if (absoluteRow < 3 || absoluteRow >= 3 + effectiveViewportRows) continue;
        const isBottomRow = absoluteRow === 3 + effectiveViewportRows - 1;
        const promptOverlay = isBottomRow && !viewport.follow ? (() => {
          const promptText = viewport.unseenRows > 0 ? `\u2193 \u6700\u65B0\u6D88\u606F \xB7 ${String(viewport.unseenRows)} \xB7 End/G \u5230\u5E95\u90E8` : "\u2193 \u5E95\u90E8 \xB7 End/G";
          const promptCol = columns - 2 - displayWidth(promptText) + 1;
          const startCol = promptCol - (contentLeft + 1);
          return startCol > 0 ? { text: promptText, startCol } : void 0;
        })() : void 0;
        const lead = assistant ? snapshotLead(ranges, index) : "";
        snapshotRows.push(createFrameSnapshotRow({
          id: `${entry.id}:${String(index)}`,
          row: absoluteRow,
          col: contentLeft + 1,
          line: framePhysicalLine(entry.id, line5, lead, entry.kind === "active", promptOverlay)
        }));
      }
    }
    return Object.freeze({
      revision: [
        contentRevision,
        String(viewport.offsetFromBottom),
        String(columns),
        String(rows),
        themeTier,
        snapshotRows.map((row) => `${row.id}:${row.identity}`).join("|")
      ].join("\0"),
      ...!generating && latestSettledAssistantId !== void 0 ? {
        repaintKey: [
          latestSettledAssistantId,
          String(columns),
          String(rows),
          themeTier
        ].join(":")
      } : {},
      geometry: Object.freeze({
        columns,
        rows,
        transcriptTop: 3,
        transcriptLeft: contentLeft + 1,
        transcriptWidth: contentWidth,
        transcriptRows: effectiveViewportRows,
        ...publishedRail === void 0 ? {} : { rail: publishedRail }
      }),
      rows: Object.freeze(snapshotRows)
    });
  }, [
    columns,
    contentLeft,
    contentRevision,
    contentWidth,
    effectiveViewportRows,
    generating,
    latestSettledAssistantId,
    presentedEntryRows,
    publishedRail,
    renderEntries,
    rows,
    themeTier,
    viewport.offsetFromBottom,
    virtualContentRows,
    virtualLayouts,
    visibleBottom,
    visibleEntryPairs,
    visibleTop
  ]);
  const publishTranscript = physicalViewport && geometryMeasured && !idleHome;
  setVisibleFrameSnapshot(publishTranscript ? visibleFrame : void 0);
  if (publishTranscript) setFrameRail(publishedRail);
  else releaseFrameRail();
  setMouseRailRegion(!publishTranscript || publishedRail === void 0 ? void 0 : {
    col: publishedRail.col,
    topRow: publishedRail.topRow,
    rows: publishedRail.rows
  });
  useLayoutEffect(() => {
    if (publishTranscript) writePublishedFrameSnapshot(stdout);
  }, [
    columns,
    rows,
    publishTranscript,
    viewport.offsetFromBottom,
    rail?.rows,
    rail?.thumbRows,
    rail?.thumbStart,
    stdout
  ]);
  useLayoutEffect(() => () => {
    setVisibleFrameSnapshot(void 0);
    releaseFrameRail();
    setMouseRailRegion(void 0);
  }, []);
  const renderReasoning = (part, key, gap, live) => /* @__PURE__ */ jsx6(Box6, { marginTop: gap, width: "100%", children: /* @__PURE__ */ jsx6(
    ReasoningBlock,
    {
      text: part.text,
      collapsed: !reasoningExpanded,
      durationMs: live ? liveDurationMs ?? part.durationMs : part.durationMs,
      live,
      maxCols: contentWidth
    }
  ) }, key);
  const renderCard = (part, key, gap) => /* @__PURE__ */ jsx6(Box6, { marginTop: gap, width: "100%", children: /* @__PURE__ */ jsx6(
    ToolCard,
    {
      card: part.card,
      expanded: toolCardsExpanded,
      maxCols: contentWidth
    }
  ) }, key);
  const renderToolSummary = (part, key, gap) => {
    const status2 = toolSummaryStatus(part.summary);
    const token = status2 === "error" ? "error" : status2 === "running" ? "accentText" : "fgDim";
    const text = toolSummaryText(part.summary, contentWidth);
    const match = text.match(/^(▸\s*)([^\s·]+)(.*)$/);
    const parts = match !== null ? [
      styled(match[1], "fgDim"),
      styled(match[2], "fgSoft"),
      styled(escapeContent(match[3]), token)
    ] : [styled(escapeContent(text), token)];
    return /* @__PURE__ */ jsx6(
      Box6,
      {
        marginTop: gap,
        width: "100%",
        backgroundColor: inkColor("toolBg"),
        children: /* @__PURE__ */ jsx6(Text6, { wrap: "truncate", children: paintBackgroundRow(parts, "toolBg", contentWidth) })
      },
      key
    );
  };
  const renderFrozenTail = (message) => {
    const showCompletionBoundary = message.id === latestSettledAssistantId;
    const cards = cardsFrom(message.content ?? []).map(
      (card) => presenterCache.present(presenters, card)
    );
    const produced = producedPathsForTurn(cards);
    const stats = formatTurnTailStats({
      turnOrdinal: message.turnOrdinal,
      turnUsage: message.turnUsage,
      legacyOutputTokens: message.usageOutputTokens,
      elapsedMs: message.stepWallMs
    });
    if (produced.length === 0 && stats === void 0 && !showCompletionBoundary) return void 0;
    const producedRows = [];
    let rowRuns = [styled("\u4EA7\u7269 \xB7 ", "fg")];
    let rowWidth = displayWidth("\u4EA7\u7269 \xB7 ");
    let pathsInRow = 0;
    const tailWidth = contentWidth;
    for (const path of produced) {
      let prefix = pathsInRow === 0 && producedRows.length === 0 ? "" : " \xB7 ";
      if (pathsInRow > 0 && rowWidth + displayWidth(`${prefix}${path}`) > tailWidth) {
        producedRows.push(rowRuns);
        rowRuns = [];
        rowWidth = 0;
        pathsInRow = 0;
        prefix = "  \xB7 ";
      }
      const segment2 = styled(escapeContent(`${prefix}${path}`), "fgDim");
      const href = isAbsolute2(path) ? pathToFileURL2(path).href : void 0;
      const run = hyperlinksEnabled() && href !== void 0 && isOsc8Href(href) ? wrapOsc8(segment2, href) : segment2;
      rowRuns.push(run);
      rowWidth += displayWidth(`${prefix}${path}`);
      pathsInRow += 1;
    }
    if (pathsInRow > 0) producedRows.push(rowRuns);
    return /* @__PURE__ */ jsxs5(Box6, { marginTop: 1, flexDirection: "column", width: "100%", children: [
      producedRows.map((runs, index) => /* @__PURE__ */ jsx6(Text6, { children: paintRow(runs) }, `produced-${String(index)}`)),
      stats === void 0 ? null : /* @__PURE__ */ jsx6(Text6, { children: paintRow([styled(escapeContent(stats), "fgDim")]) }),
      showCompletionBoundary ? /* @__PURE__ */ jsx6(Text6, { children: paintRow([styled("\u2500\u2500 \u5DF2\u5B8C\u6210 \u2500\u2500", "fgDim")]) }) : null
    ] }, "turn-tail");
  };
  const renderFrozenMessage = (message) => {
    const parts = displayedParts(
      compactToolParts(partsFromFrozen(message), toolCardsExpanded, presenters, mode, presenterCache),
      reasoningExpanded
    );
    const blocks = parts.map((part, index) => {
      const gap = turnPartGap(parts, index);
      if (part.kind === "reasoning") {
        return /* @__PURE__ */ jsx6(Box6, { marginTop: gap, width: "100%", children: /* @__PURE__ */ jsx6(
          ReasoningBlock,
          {
            text: part.text,
            collapsed: !reasoningExpanded,
            durationMs: part.durationMs,
            maxCols: contentWidth
          }
        ) }, index);
      }
      if (part.kind === "tool-summary") return renderToolSummary(part, index, gap);
      if (part.kind === "card") return renderCard(part, index, gap);
      return /* @__PURE__ */ jsx6(Box6, { marginTop: gap, width: "100%", children: /* @__PURE__ */ jsx6(
        SettledMarkdownBlock,
        {
          source: part.text,
          maxCols: Math.max(1, contentWidth - ASSISTANT_PROSE_PREFIX_COLUMNS),
          themeTier: currentTier()
        }
      ) }, index);
    });
    const tail = renderFrozenTail(message);
    const rows2 = [];
    rows2.push(...blocks);
    if (tail !== void 0) rows2.push(tail);
    return rows2;
  };
  const renderCompaction = (divider) => {
    const expanded = divider.compactionId === expandedCompactionId;
    return /* @__PURE__ */ jsxs5(Box6, { flexDirection: "column", width: "100%", children: [
      /* @__PURE__ */ jsx6(Text6, { children: paintRow([styled(escapeContent(compactionDividerLabel(divider, expanded)), "fgDim")]) }),
      expanded && divider.summary !== "" ? /* @__PURE__ */ jsx6(Text6, { children: paintRow([
        styled("\u6458\u8981 ", "fgDim"),
        styled(escapeContent(divider.summary), "fg")
      ]) }) : null
    ] });
  };
  const renderActiveTurn = (turn) => {
    const rawParts = partsFromTurn(turn);
    const visibleParts = displayedParts(rawParts, reasoningExpanded);
    if (generating && visibleParts.length === 0) {
      const liveMs = liveDurationMs ?? turn.reasoningDurationMs;
      const spinner = getBrailleSpinnerFrame(liveMs);
      const tip = getBilingualTip(liveMs, locale);
      const label = rawParts.some((p) => p.kind === "reasoning") ? tuiCopy("thinking", locale) : tuiCopy("processing", locale);
      return /* @__PURE__ */ jsxs5(Box6, { flexDirection: "column", width: "100%", flexShrink: 0, children: [
        /* @__PURE__ */ jsx6(Text6, { children: paintRow([
          styled(spinner, "accentText", void 0, true),
          styled(" \u25CF ", "accentText", void 0, true),
          styled(
            `${label} (${formatSeconds(liveMs)}s)`,
            "fg"
          )
        ]) }),
        /* @__PURE__ */ jsx6(Text6, { children: paintRow([
          styled(`  \u2514 ${tip}`, "fgDim")
        ]) })
      ] });
    }
    const parts = displayedParts(compactToolParts(rawParts, toolCardsExpanded, presenters, mode, presenterCache), reasoningExpanded);
    let lastVisiblePart = -1;
    parts.forEach((part, index) => {
      if (isVisiblePart(part)) lastVisiblePart = index;
    });
    const lastRaw = rawParts[rawParts.length - 1];
    const lastVisible = parts[parts.length - 1];
    const isReasoningActive = lastRaw?.kind === "reasoning";
    const isToolCompleted = lastVisible?.kind === "card" && lastVisible.card.status !== "running" || lastVisible?.kind === "tool-summary" && lastVisible.summary.runningCount === 0;
    const showTail = generating && (isReasoningActive && !reasoningExpanded || isToolCompleted);
    const tailLiveMs = liveDurationMs ?? turn.reasoningDurationMs;
    const tailSpinner = getBrailleSpinnerFrame(tailLiveMs);
    const tailLabel = isReasoningActive ? tuiCopy("thinking", locale) : tuiCopy("processing", locale);
    return /* @__PURE__ */ jsxs5(Box6, { flexDirection: "column", width: "100%", flexShrink: 0, children: [
      parts.map((part, index) => {
        const gap = turnPartGap(parts, index);
        if (part.kind === "reasoning") {
          const live = generating && index === lastVisiblePart;
          return renderReasoning(part, index, gap, live);
        }
        if (part.kind === "tool-summary") return renderToolSummary(part, index, gap);
        if (part.kind === "card") return renderCard(part, index, gap);
        return /* @__PURE__ */ jsx6(Box6, { marginTop: gap, width: "100%", children: /* @__PURE__ */ jsx6(
          MarkdownBlock,
          {
            source: part.text,
            maxCols: Math.max(1, contentWidth - ASSISTANT_PROSE_PREFIX_COLUMNS),
            prefix: { first: activeMarker(), rest: restIndent() }
          }
        ) }, index);
      }),
      showTail && /* @__PURE__ */ jsx6(Box6, { marginTop: 1, children: /* @__PURE__ */ jsx6(Text6, { children: paintRow([
        styled(tailSpinner, "accentText", void 0, true),
        styled(" \u25CF ", "accentText", void 0, true),
        styled(
          `${tailLabel} (${formatSeconds(tailLiveMs)}s)`,
          "fg"
        )
      ]) }) })
    ] });
  };
  const transcriptViewport = /* @__PURE__ */ jsxs5(
    Box6,
    {
      ref: viewportRef,
      flexDirection: "column",
      position: "relative",
      width: "100%",
      flexGrow: 1,
      overflow: "hidden",
      justifyContent: idleHome ? "center" : "flex-start",
      alignItems: idleHome ? "center" : "flex-start",
      children: [
        idleHome ? /* @__PURE__ */ jsx6(
          PixelFishHome,
          {
            tier: brandTier,
            animate: brandAnimation,
            visible: true,
            maxColumns: contentWidth,
            maxRows: viewport.viewportRows > 0 ? viewport.viewportRows : Math.max(0, rows - 7),
            frameProbe: brandFrameProbe
          }
        ) : /* @__PURE__ */ jsxs5(
          Box6,
          {
            flexDirection: "column",
            position: physicalViewport ? "absolute" : "relative",
            bottom: physicalViewport ? -effectiveOffset : void 0,
            left: physicalViewport ? contentLeft : void 0,
            marginLeft: physicalViewport ? void 0 : contentLeft,
            width: contentWidth,
            flexShrink: 0,
            children: [
              leadingRows > 0 ? /* @__PURE__ */ jsx6(Box6, { height: leadingRows, flexShrink: 0 }) : null,
              visibleEntryPairs.map(({ entry, index: layoutIndex }) => {
                const blockId = entry.id;
                const entryLines = entry.lines;
                const layout = virtualLayouts[layoutIndex];
                let window;
                if (physicalViewport) {
                  window = sliceWindow(
                    entryLines.length,
                    layout?.top ?? 0,
                    overscanTop,
                    overscanBottom
                  );
                }
                if (entry.kind === "active") {
                  if (window !== void 0) {
                    const ranges = activeEntryRows.textRanges.get(blockId) ?? EMPTY_TEXT_RANGES;
                    return /* @__PURE__ */ jsxs5(
                      Box6,
                      {
                        ref: (element) => {
                          if (element === null) blockRefs.current.delete(blockId);
                          else blockRefs.current.set(blockId, element);
                        },
                        flexDirection: "column",
                        width: "100%",
                        flexShrink: 0,
                        children: [
                          window.start > 0 ? /* @__PURE__ */ jsx6(Box6, { height: window.start, flexShrink: 0 }) : null,
                          /* @__PURE__ */ jsx6(
                            SlicedLinesBlock,
                            {
                              lines: entryLines,
                              sliceStart: window.start,
                              sliceEnd: window.end,
                              prefix: { first: activeMarker(), rest: restIndent() },
                              textRanges: ranges
                            }
                          ),
                          window.end < entryLines.length ? /* @__PURE__ */ jsx6(Box6, { height: entryLines.length - window.end, flexShrink: 0 }) : null
                        ]
                      },
                      blockId
                    );
                  }
                  return /* @__PURE__ */ jsx6(
                    Box6,
                    {
                      ref: (element) => {
                        if (element === null) blockRefs.current.delete(blockId);
                        else blockRefs.current.set(blockId, element);
                      },
                      flexDirection: "column",
                      width: "100%",
                      flexShrink: 0,
                      children: renderActiveTurn(entry.turn)
                    },
                    blockId
                  );
                }
                const row = entry.row;
                if (window !== void 0) {
                  const assistant = row.kind === "message" && row.message.kind === "assistant";
                  const ranges = assistant ? activeEntryRows.textRanges.get(blockId) ?? EMPTY_TEXT_RANGES : EMPTY_TEXT_RANGES;
                  return /* @__PURE__ */ jsxs5(
                    Box6,
                    {
                      ref: (element) => {
                        if (element === null) blockRefs.current.delete(blockId);
                        else blockRefs.current.set(blockId, element);
                      },
                      flexDirection: "column",
                      width: "100%",
                      paddingBottom: entry.gapRows,
                      flexShrink: 0,
                      children: [
                        window.start > 0 ? /* @__PURE__ */ jsx6(Box6, { height: window.start, flexShrink: 0 }) : null,
                        /* @__PURE__ */ jsx6(
                          SlicedLinesBlock,
                          {
                            lines: entryLines,
                            sliceStart: window.start,
                            sliceEnd: window.end,
                            prefix: {
                              first: kindMarker("\u25CF ", "accentText"),
                              rest: restIndent()
                            },
                            textRanges: ranges
                          }
                        ),
                        window.end < entryLines.length ? /* @__PURE__ */ jsx6(Box6, { height: entryLines.length - window.end, flexShrink: 0 }) : null
                      ]
                    },
                    blockId
                  );
                }
                let rowNode;
                if (row.kind === "compaction") {
                  rowNode = renderCompaction(row.divider);
                } else if (row.message.kind === "user") {
                  const hasSubsequent = layoutIndex < renderEntries.length - 1 || activeTurn !== void 0;
                  rowNode = /* @__PURE__ */ jsxs5(Box6, { flexDirection: "column", width: "100%", children: [
                    /* @__PURE__ */ jsx6(Box6, { width: "100%", backgroundColor: inkColor("messageBg"), children: /* @__PURE__ */ jsx6(Text6, { wrap: "wrap", children: userRun(row.message.text, contentWidth) }) }),
                    hasSubsequent ? /* @__PURE__ */ jsx6(Text6, { children: styled("\u2500".repeat(contentWidth), "line") }) : null
                  ] });
                } else {
                  rowNode = renderFrozenMessage(row.message);
                }
                const isUserWithGap = row.kind === "message" && row.message.kind === "user" && (layoutIndex < renderEntries.length - 1 || activeTurn !== void 0);
                return /* @__PURE__ */ jsx6(
                  Box6,
                  {
                    ref: (element) => {
                      if (element === null) blockRefs.current.delete(blockId);
                      else blockRefs.current.set(blockId, element);
                    },
                    flexDirection: "column",
                    width: "100%",
                    paddingBottom: isUserWithGap ? 1 : entry.gapRows,
                    flexShrink: 0,
                    children: rowNode
                  },
                  blockId
                );
              }),
              trailingRows > 0 ? /* @__PURE__ */ jsx6(Box6, { height: trailingRows, flexShrink: 0 }) : null
            ]
          }
        ),
        !viewport.follow ? /* @__PURE__ */ jsx6(Box6, { position: "absolute", right: 2, bottom: 0, children: /* @__PURE__ */ jsx6(Text6, { children: styled(
          viewport.unseenRows > 0 ? `\u2193 \u6700\u65B0\u6D88\u606F \xB7 ${String(viewport.unseenRows)} \xB7 End/G \u5230\u5E95\u90E8` : "\u2193 \u5E95\u90E8 \xB7 End/G",
          "accentText"
        ) }) }) : null
      ]
    }
  );
  return transcriptViewport;
}

// tui-render/src/loop.tsx
import { homedir } from "node:os";
import { Box as Box24, Text as Text31, useInput, usePaste, useWindowSize as useWindowSize9 } from "ink";
import {
  createElement as createElement2,
  useCallback as useCallback2,
  useEffect as useEffect3,
  useMemo as useMemo2,
  useRef as useRef4,
  useState as useState3,
  useSyncExternalStore
} from "react";

// tui-render/src/session-pane.tsx
import { Box as Box7, Text as Text7 } from "ink";
import { jsx as jsx7, jsxs as jsxs6 } from "react/jsx-runtime";
var SESSION_ID_HINT_MIN_LENGTH = 8;
function compactSessionId(id) {
  return id.startsWith("session-") ? id.slice("session-".length) : id;
}
function duplicateTitleHints(rows) {
  const byTitle = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const peers = byTitle.get(row.title);
    if (peers === void 0) byTitle.set(row.title, [row]);
    else peers.push(row);
  }
  const hints = /* @__PURE__ */ new Map();
  for (const peers of byTitle.values()) {
    if (peers.length < 2) continue;
    const compactIds = peers.map((row) => compactSessionId(row.id));
    const candidates = new Set(compactIds).size === compactIds.length ? compactIds : peers.map((row) => row.id);
    for (const [index, row] of peers.entries()) {
      const candidate = candidates[index];
      let length = Math.min(SESSION_ID_HINT_MIN_LENGTH, candidate.length);
      while (length < candidate.length && candidates.some((other, otherIndex) => otherIndex !== index && other.startsWith(candidate.slice(0, length)))) {
        length += 1;
      }
      hints.set(row.id, candidate.slice(0, length));
    }
  }
  return hints;
}
function relativeTime(updatedAt, now) {
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 6e4));
  if (minutes < 1) return "\u521A\u521A";
  if (minutes < 60) return `${minutes} \u5206\u949F\u524D`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
  return `${Math.floor(hours / 24)} \u5929\u524D`;
}
function SessionPane({
  rows,
  selectedIndex,
  currentId,
  confirmDelete,
  deleteUnavailable = false,
  now,
  columns,
  maxRows
}) {
  const width = Math.max(1, columns);
  const budget = Math.max(1, maxRows);
  const clock = now ?? Date.now();
  const showControls = budget >= 2;
  const showIdentity = budget >= 3 && rows.some((row) => row.id === currentId);
  const reserved = Number(showControls) + Number(showIdentity);
  const showOverflow = budget >= 4 && rows.length > budget - reserved;
  const size = Math.min(rows.length, Math.max(1, budget - reserved - Number(showOverflow)));
  const clampedSelectedIndex = Math.min(
    Math.max(selectedIndex, 0),
    Math.max(0, rows.length - 1)
  );
  const start = Math.min(
    Math.max(clampedSelectedIndex - Math.floor(size / 2), 0),
    rows.length - size
  );
  const visible = rows.slice(start, start + size);
  const titleHints = duplicateTitleHints(rows);
  const localSelectedIndex = clampedSelectedIndex - start;
  const selected = rows[clampedSelectedIndex];
  return /* @__PURE__ */ jsxs6(Box7, { flexDirection: "column", width, children: [
    rows.length === 0 ? /* @__PURE__ */ jsx7(Text7, { dimColor: true, children: "\u65E0\u4F1A\u8BDD" }) : visible.map((row, index) => {
      const highlighted = index === localSelectedIndex;
      const titleHint = titleHints.get(row.id);
      const hint = titleHint === void 0 ? "" : ` \xB7 ${escapeContent(titleHint)}`;
      const marker = row.id === currentId ? " \xB7 \u5F53\u524D" : "";
      const age = relativeTime(row.updatedAt, clock);
      const title = truncateDisplay(
        escapeContent(row.title).replace(/\n/gu, " "),
        width - 3 - displayWidth(hint + age + marker)
      );
      const displayTitle = title + hint;
      const gap = Math.max(1, width - 2 - displayWidth(displayTitle + age + marker));
      return /* @__PURE__ */ jsxs6(Box7, { width: "100%", flexDirection: "column", children: [
        /* @__PURE__ */ jsxs6(Text7, { wrap: "truncate", children: [
          highlighted ? styled("\u203A ", "accent", void 0, true) : "  ",
          styled(displayTitle, highlighted ? "fg" : "fgDim"),
          " ".repeat(gap),
          styled(age, "fgDim"),
          styled(marker, "accentDim")
        ] }),
        showIdentity && row.id === currentId ? /* @__PURE__ */ jsx7(Text7, { dimColor: true, wrap: "truncate", children: escapeContent(`\u4F1A\u8BDD ID \xB7 ${row.id}`) }) : null
      ] }, row.id);
    }),
    showOverflow ? /* @__PURE__ */ jsxs6(Text7, { dimColor: true, wrap: "truncate", children: [
      "\u2026 \u8FD8\u6709 ",
      rows.length - size,
      " \u4E2A\u4F1A\u8BDD"
    ] }) : null,
    !showControls ? null : confirmDelete ? /* @__PURE__ */ jsx7(Text7, { wrap: "truncate", children: styled(
      `\u518D\u6309 d \u786E\u8BA4\u5220\u9664\u300C${escapeContent(selected?.title ?? "")}\u300D`,
      "error"
    ) }) : deleteUnavailable ? /* @__PURE__ */ jsxs6(Text7, { wrap: "truncate", children: [
      styled(escapeContent("\u2191\u2193/jk \u9009\u62E9 \xB7 Enter \u5207\u6362 \xB7 r \u91CD\u547D\u540D \xB7 g s \u5173\u95ED \xB7 "), "fgDim"),
      styled(escapeContent("\u5220\u9664\u4E0D\u53EF\u7528\uFF08\u540E\u7AEF\u80FD\u529B\u7F3A\u5931\uFF09"), "error")
    ] }) : /* @__PURE__ */ jsx7(Text7, { wrap: "truncate", children: styled(escapeContent("\u2191\u2193/jk \u9009\u62E9 \xB7 Enter \u5207\u6362 \xB7 r \u91CD\u547D\u540D \xB7 d \u5220\u9664 \xB7 g s \u5173\u95ED"), "fgDim") })
  ] });
}

// tui-render/src/search-pane.tsx
import { Box as Box8, Text as Text8 } from "ink";
import { jsx as jsx8, jsxs as jsxs7 } from "react/jsx-runtime";
var SEARCH_WINDOW = 30;
function SearchPane({
  query,
  results,
  selectedIndex,
  status = "idle"
}) {
  const visible = results.slice(0, SEARCH_WINDOW);
  return /* @__PURE__ */ jsxs7(Box8, { flexDirection: "column", width: "100%", children: [
    /* @__PURE__ */ jsxs7(Text8, { children: [
      "\u641C\u7D22: ",
      escapeContent(query)
    ] }),
    status === "searching" ? /* @__PURE__ */ jsx8(Text8, { dimColor: true, children: "\u641C\u7D22\u4E2D\u2026" }) : status === "error" ? /* @__PURE__ */ jsx8(Text8, { children: "\u641C\u7D22\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" }) : results.length === 0 ? /* @__PURE__ */ jsx8(Text8, { dimColor: true, children: query === "" ? "\u8F93\u5165\u5173\u952E\u8BCD\u641C\u7D22\u4F1A\u8BDD" : "\u65E0\u5339\u914D\u4F1A\u8BDD" }) : visible.map((row, index) => {
      const highlighted = index === selectedIndex;
      return /* @__PURE__ */ jsxs7(Box8, { width: "100%", children: [
        /* @__PURE__ */ jsx8(Text8, { children: highlighted ? styled(escapeContent("\u203A "), "accent", void 0, true) : "  " }),
        /* @__PURE__ */ jsx8(Text8, { dimColor: !highlighted, children: escapeContent(row.title) }),
        /* @__PURE__ */ jsxs7(Text8, { dimColor: !highlighted, children: [
          " \u2014 ",
          escapeContent(row.snippet)
        ] })
      ] }, row.id);
    }),
    status !== "searching" && results.length > SEARCH_WINDOW ? /* @__PURE__ */ jsxs7(Text8, { dimColor: true, children: [
      "\u2026 \u8FD8\u6709 ",
      results.length - SEARCH_WINDOW,
      " \u6761\u7ED3\u679C"
    ] }) : null,
    /* @__PURE__ */ jsx8(Text8, { children: styled(escapeContent("\u2191\u2193/jk \u9009\u62E9 \xB7 Enter \u6062\u590D \xB7 Esc \u5173\u95ED"), "fgDim") })
  ] });
}

// tui-render/src/model-pane.tsx
import { Box as Box9, Text as Text9 } from "ink";
import { jsx as jsx9, jsxs as jsxs8 } from "react/jsx-runtime";
var MODEL_WINDOW = 30;
function ModelPane({
  filter,
  rows,
  selectedIndex,
  status = "idle",
  error
}) {
  const windowStart = Math.min(
    Math.max(0, selectedIndex - MODEL_WINDOW + 1),
    Math.max(0, rows.length - MODEL_WINDOW)
  );
  const visible = rows.slice(windowStart, windowStart + MODEL_WINDOW);
  const hiddenBelow = rows.length - windowStart - visible.length;
  const windowHint = windowStart === 0 ? `\u2026 \u8FD8\u6709 ${hiddenBelow} \u4E2A\u6A21\u578B` : hiddenBelow === 0 ? `\u2026 \u4E0A\u65B9 ${windowStart} \u4E2A\u6A21\u578B` : `\u2026 \u4E0A\u65B9 ${windowStart} \u4E2A \xB7 \u4E0B\u65B9 ${hiddenBelow} \u4E2A\u6A21\u578B`;
  return /* @__PURE__ */ jsxs8(Box9, { flexDirection: "column", width: "100%", children: [
    /* @__PURE__ */ jsxs8(Text9, { children: [
      "\u6A21\u578B: ",
      escapeContent(filter)
    ] }),
    status === "loading" ? /* @__PURE__ */ jsx9(Text9, { children: styled(escapeContent("\u52A0\u8F7D\u4E2D\u2026"), "fgDim") }) : status === "error" ? /* @__PURE__ */ jsx9(Text9, { children: styled(
      escapeContent(`\u2717 \u52A0\u8F7D\u5931\u8D25\uFF1A${error === void 0 || error === "" ? "\u6A21\u578B\u76EE\u5F55\u4E0D\u53EF\u7528" : error}`),
      "error"
    ) }) : rows.length === 0 ? /* @__PURE__ */ jsx9(Text9, { children: styled(escapeContent("\u65E0\u53EF\u7528\u6A21\u578B"), "fgDim") }) : visible.map((row, index) => {
      const highlighted = windowStart + index === selectedIndex;
      return /* @__PURE__ */ jsxs8(Box9, { width: "100%", children: [
        /* @__PURE__ */ jsx9(Text9, { children: highlighted ? styled(escapeContent("\u203A "), "accent", void 0, true) : "  " }),
        /* @__PURE__ */ jsx9(Text9, { dimColor: !highlighted, children: escapeContent(row.name) }),
        /* @__PURE__ */ jsx9(Text9, { dimColor: !highlighted, children: highlighted ? ` ${styled(escapeContent(row.provider), "fgDim")}` : ` ${escapeContent(row.provider)}` }),
        row.current ? /* @__PURE__ */ jsx9(Text9, { children: styled(escapeContent(" \xB7 \u5F53\u524D"), "accentDim") }) : null
      ] }, row.id);
    }),
    status !== "loading" && status !== "error" && rows.length > MODEL_WINDOW ? /* @__PURE__ */ jsx9(Text9, { dimColor: true, children: windowHint }) : null,
    /* @__PURE__ */ jsx9(Text9, { children: styled(escapeContent("\u2191\u2193/jk \u9009\u62E9 \xB7 Enter \u5207\u6362 \xB7 Esc \u5173\u95ED"), "fgDim") })
  ] });
}

// tui-render/src/help-pane.tsx
import { Box as Box10, Text as Text10 } from "ink";
import { jsx as jsx10, jsxs as jsxs9 } from "react/jsx-runtime";
var HELP_WINDOW = 20;
function HelpPane({ lines, offset }) {
  const maxOffset2 = Math.max(0, lines.length - HELP_WINDOW);
  const safeOffset = Math.min(offset, maxOffset2);
  const visible = lines.slice(safeOffset, safeOffset + HELP_WINDOW);
  return /* @__PURE__ */ jsxs9(Box10, { flexDirection: "column", width: "100%", children: [
    safeOffset > 0 ? /* @__PURE__ */ jsxs9(Text10, { dimColor: true, children: [
      "\u2026 \u8FD8\u6709 ",
      safeOffset,
      " \u884C"
    ] }) : null,
    visible.map((line5, index) => /* @__PURE__ */ jsx10(Text10, { children: escapeContent(line5) }, safeOffset + index)),
    /* @__PURE__ */ jsx10(Text10, { children: styled(escapeContent("\u2191\u2193/jk \u6EDA\u52A8 \xB7 Esc/Enter \u5173\u95ED"), "fgDim") })
  ] });
}

// tui-render/src/approval-pane.tsx
import { Box as Box11, Text as Text11 } from "ink";
import { jsx as jsx11, jsxs as jsxs10 } from "react/jsx-runtime";
var DELIVERY_NEXT = "\u5F53\u524D\u5DE5\u5177\u672A\u6267\u884C \xB7 \u53EF\u91CD\u8BD5\u8BE5\u8F6E";
var EMPTY_APPROVAL_PANE = {
  open: false,
  toolName: "",
  reason: "",
  arguments: "",
  detailsOpen: false
};
function extraArgumentLine(raw) {
  if (raw.trim() === "") return void 0;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "command" in parsed && typeof parsed.command === "string") {
      return parsed.command;
    }
    return void 0;
  } catch {
    return raw;
  }
}
function line(text, token, bold = false) {
  return /* @__PURE__ */ jsx11(Text11, { children: paintRow([styled(escapeContent(text), token, void 0, bold)]) });
}
function ApprovalPane({
  toolName,
  reason,
  arguments: rawArguments,
  detailsOpen,
  deliveryError
}) {
  const extra = extraArgumentLine(rawArguments);
  const escapedTool = escapeContent(toolName);
  const escapedExtra = extra !== void 0 ? escapeContent(extra) : void 0;
  const target = escapedExtra !== void 0 ? `${escapedTool} "${escapedExtra}"` : escapedTool;
  return /* @__PURE__ */ jsx11(Box11, { flexDirection: "column", width: "100%", children: deliveryError !== void 0 ? /* @__PURE__ */ jsxs10(Box11, { flexDirection: "column", width: "100%", children: [
    line(`\u2717 \u5BA1\u6279\u672A\u80FD\u9001\u8FBE\uFF1A${deliveryError}`, "error"),
    line(DELIVERY_NEXT, "fgDim")
  ] }) : /* @__PURE__ */ jsxs10(Box11, { flexDirection: "column", width: "100%", children: [
    /* @__PURE__ */ jsx11(Text11, { children: paintRow([
      styled(`\u5141\u8BB8\u6267\u884C ${target} \u5417\uFF1F`, "fg", void 0, true)
    ]) }),
    /* @__PURE__ */ jsxs10(Box11, { flexDirection: "column", marginTop: 1, width: "100%", children: [
      /* @__PURE__ */ jsx11(Text11, { children: paintRow([
        styled("  [Y] ", "success", void 0, true),
        styled("\u5141\u8BB8", "fg", void 0, true),
        styled(" (\u6267\u884C\u4E00\u6B21)", "fgDim")
      ]) }),
      /* @__PURE__ */ jsx11(Text11, { children: paintRow([
        styled("  [n] ", "error", void 0, true),
        styled("\u62D2\u7EDD", "fg", void 0, true),
        styled(" (\u53D6\u6D88\u6267\u884C)", "fgDim")
      ]) }),
      /* @__PURE__ */ jsx11(Text11, { children: paintRow([
        styled("  [a] ", "warning", void 0, true),
        styled("\u672C\u4F1A\u8BDD\u603B\u662F", "fg", void 0, true),
        styled(" (\u4E0D\u518D\u8BE2\u95EE)", "fgDim")
      ]) }),
      /* @__PURE__ */ jsx11(Text11, { children: paintRow([
        styled("  [i] ", "accent", void 0, true),
        styled(detailsOpen ? "\u6536\u8D77\u8BE6\u60C5" : "\u8BE6\u60C5 (\u67E5\u770B\u5B8C\u6574\u53C2\u6570)", "fgDim")
      ]) })
    ] }),
    detailsOpen ? /* @__PURE__ */ jsxs10(Box11, { flexDirection: "column", marginTop: 1, width: "100%", children: [
      reason !== "" ? line(reason, "fg") : null,
      extra !== void 0 ? line(extra, "fg") : null
    ] }) : null
  ] }) });
}

// tui-render/src/permission-pane.tsx
import { Box as Box13, Text as Text13 } from "ink";

// tui-render/src/overlay-shell.tsx
import { Box as Box12, Text as Text12 } from "ink";
import { jsx as jsx12, jsxs as jsxs11 } from "react/jsx-runtime";
var EMPTY_OVERLAY_PANE = { open: false };
function renderPaneLine(text, token, bold = false) {
  return /* @__PURE__ */ jsx12(Text12, { children: paintRow([styled(escapeContent(text), token, void 0, bold)]) });
}
var line2 = renderPaneLine;
function OverlayShell({
  title,
  body,
  footnote,
  error,
  errorNext,
  children
}) {
  return /* @__PURE__ */ jsxs11(Box12, { flexDirection: "column", width: "100%", children: [
    line2(title, "fg", true),
    body !== void 0 && body !== "" ? line2(body, "fg") : null,
    children,
    error !== void 0 && error !== "" ? line2(`\u2717 ${error}`, "error") : null,
    error !== void 0 && error !== "" && errorNext !== void 0 && errorNext !== "" ? line2(errorNext, "fgDim") : null,
    line2(footnote, "fgDim")
  ] });
}

// tui-render/src/permission-pane.tsx
import { jsx as jsx13, jsxs as jsxs12 } from "react/jsx-runtime";
var TITLE = "\u6743\u9650\u9884\u8BBE";
var FOOTNOTE = "\u2191\u2193/jk \u9009\u62E9 \xB7 1-3 \u76F4\u8FBE \xB7 Enter \u5E94\u7528 \xB7 Esc \u5173\u95ED";
var CONFIRM = "\u786E\u8BA4\u5207\u6362\u5230 danger-full-access\uFF1F";
var CONFIRM_FOOTNOTE = "\u518D\u6309 Enter \u786E\u8BA4 \xB7 Esc \u53D6\u6D88";
var FAIL_NEXT = "\u5F53\u524D\u9884\u8BBE\u4FDD\u6301\u4E0D\u53D8 \xB7 \u53EF\u91CD\u8BD5";
var EMPTY_TABLE_REASON = "\u65E0\u53EF\u7528\u9884\u8BBE";
var EMPTY_PERMISSION_PANE = {
  open: false,
  names: [],
  selectedIndex: 0,
  currentName: "",
  confirmDanger: false
};
function PermissionPane({
  names,
  selectedIndex,
  currentName,
  confirmDanger,
  descriptions,
  switchError
}) {
  if (confirmDanger) {
    return /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", width: "100%", children: [
      renderPaneLine(CONFIRM, "fg", true),
      renderPaneLine(CONFIRM_FOOTNOTE, "fgDim")
    ] });
  }
  const errorReason = switchError ?? (names.length === 0 ? EMPTY_TABLE_REASON : void 0);
  return /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", width: "100%", children: [
    renderPaneLine(TITLE, "fg", true),
    names.map((name, index) => {
      const selected = index === selectedIndex;
      const current = name === currentName;
      const description = descriptions?.[index];
      const label = current ? `${name} \xB7 \u5F53\u524D` : name;
      return /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", width: "100%", children: [
        /* @__PURE__ */ jsxs12(Box13, { width: "100%", children: [
          /* @__PURE__ */ jsx13(Text13, { children: selected ? styled(escapeContent("\u203A "), "accent", void 0, true) : "  " }),
          /* @__PURE__ */ jsx13(Text13, { children: paintRow([styled(escapeContent(label), selected ? "fg" : "fgDim")]) })
        ] }),
        description !== void 0 && description !== "" ? renderPaneLine(description, "fgDim") : null
      ] }, name);
    }),
    errorReason !== void 0 ? /* @__PURE__ */ jsxs12(Box13, { flexDirection: "column", width: "100%", children: [
      renderPaneLine(`\u2717 \u5207\u6362\u6743\u9650\u5931\u8D25\uFF1A${errorReason}`, "error"),
      renderPaneLine(FAIL_NEXT, "fgDim")
    ] }) : null,
    renderPaneLine(FOOTNOTE, "fgDim")
  ] });
}

// tui-render/src/settings-pane.tsx
import { Box as Box14, Text as Text14, useWindowSize as useWindowSize5 } from "ink";
import { jsx as jsx14, jsxs as jsxs13 } from "react/jsx-runtime";
var TITLE2 = "\u8BBE\u7F6E";
var ONBOARDING_TITLE = "\u9996\u6B21\u8BBE\u7F6E";
var FOOTNOTE2 = "\u2191\u2193/jk \u9009\u62E9 \xB7 Enter \u7F16\u8F91 \xB7 e \u5BFC\u51FA \xB7 r \u91CD\u8F7D \xB7 Esc \u5173\u95ED";
var EDIT_FOOTNOTE = "Enter \u5E94\u7528 \xB7 Esc \u53D6\u6D88";
var ONBOARDING_FOOTNOTE = "Enter \u4FDD\u5B58 \xB7 Esc \u8DF3\u8FC7";
var SETTINGS_WINDOW = 8;
var MARKER_COLS = 2;
var VALUE_GAP = 2;
var VALUE_ELLIPSIS = "\u2026";
var FAIL_NEXT2 = "\u5F53\u524D\u503C\u4FDD\u6301\u4E0D\u53D8 \xB7 \u53EF\u91CD\u8BD5";
var EMPTY_TABLE_REASON2 = "\u65E0\u53EF\u7528\u8BBE\u7F6E";
var EMPTY_SETTINGS_PANE = {
  open: false,
  rows: [],
  selectedIndex: 0,
  editing: false
};
function fitValue(value, maxCols) {
  if (maxCols <= 0) return "";
  if (displayWidth(value) <= maxCols) return value;
  const ellipsisWidth = displayWidth(VALUE_ELLIPSIS);
  const budget = maxCols - ellipsisWidth;
  if (budget <= 0) return wcwidthSafeSlice(VALUE_ELLIPSIS, maxCols);
  return `${wcwidthSafeSlice(value, budget)}${VALUE_ELLIPSIS}`;
}
function fieldRow(label, value, selected, columns) {
  const marker = selected ? styled(escapeContent("\u203A "), "accent", void 0, true) : "  ";
  const escapedLabel = escapeContent(label);
  const escapedValue = escapeContent(value);
  const labelToken = selected ? "fg" : "fgDim";
  const labelCols = MARKER_COLS + displayWidth(escapedLabel);
  const valueBudget = Math.max(0, columns - labelCols - VALUE_GAP);
  const fittedValue = fitValue(escapedValue, valueBudget);
  const gap = Math.max(
    VALUE_GAP,
    columns - labelCols - displayWidth(fittedValue)
  );
  return [
    marker,
    styled(escapedLabel, labelToken),
    styled(" ".repeat(gap), "bg"),
    ...fittedValue === "" ? [] : [styled(fittedValue, "fgDim")]
  ];
}
function computeSettingsWindow(maxRows, totalRows, errorReason) {
  if (maxRows === void 0) return SETTINGS_WINDOW;
  const errorLines = errorReason === void 0 ? 0 : errorReason === EMPTY_TABLE_REASON2 ? 1 : 2;
  const fixedOverhead = 2 + errorLines;
  const available = Math.max(1, maxRows - fixedOverhead);
  if (totalRows <= available) {
    return totalRows;
  }
  return Math.max(1, available - 2);
}
function SettingsPane({
  rows,
  selectedIndex,
  editing,
  onboarding,
  updateError,
  locale,
  maxRows
}) {
  const { columns } = useWindowSize5();
  const width = columns > 0 ? columns : 80;
  const errorReason = updateError ?? (rows.length === 0 ? EMPTY_TABLE_REASON2 : void 0);
  const footnote = onboarding === true ? ONBOARDING_FOOTNOTE : editing ? EDIT_FOOTNOTE : FOOTNOTE2;
  const windowLimit = computeSettingsWindow(maxRows, rows.length, errorReason);
  const size = Math.min(windowLimit, rows.length);
  const start = rows.length <= size ? 0 : Math.min(
    Math.max(0, selectedIndex - Math.floor(size / 2)),
    rows.length - size
  );
  const visible = rows.slice(start, start + size);
  return /* @__PURE__ */ jsxs13(Box14, { flexDirection: "column", width: "100%", children: [
    renderPaneLine(onboarding === true ? ONBOARDING_TITLE : TITLE2, "fg", true),
    start > 0 ? renderPaneLine(`\u2026 \u8FD8\u6709 ${String(start)} \u9879`, "fgDim") : null,
    visible.map((row, index) => {
      const absolute = start + index;
      const selected = absolute === selectedIndex;
      const localized = row.namespace === "tui" && (row.field === "reasoning" || row.field === "scrollbar" || row.field === "statusDetails" || row.field === "locale") ? `${row.field} \xB7 ${tuiCopy(row.field, locale)}` : row.field === "apiKeyEnv" ? `${row.field} \xB7 \u73AF\u5883\u53D8\u91CF\u540D` : row.field;
      const label = `${row.namespace} \xB7 ${localized}`;
      return /* @__PURE__ */ jsx14(Box14, { width: "100%", children: /* @__PURE__ */ jsx14(Text14, { children: paintRow(fieldRow(label, row.value, selected, width)) }) }, `${row.namespace}:${row.field}`);
    }),
    rows.length > start + size ? renderPaneLine(`\u2026 \u8FD8\u6709 ${String(rows.length - start - size)} \u9879`, "fgDim") : null,
    errorReason !== void 0 ? /* @__PURE__ */ jsxs13(Box14, { flexDirection: "column", width: "100%", children: [
      renderPaneLine(
        errorReason === EMPTY_TABLE_REASON2 ? EMPTY_TABLE_REASON2 : `\u2717 \u66F4\u65B0\u5931\u8D25\uFF1A${errorReason}`,
        "error"
      ),
      errorReason === EMPTY_TABLE_REASON2 ? null : renderPaneLine(FAIL_NEXT2, "fgDim")
    ] }) : null,
    renderPaneLine(footnote, "fgDim")
  ] });
}

// tui-render/src/agent-hub-pane.tsx
import { Box as Box15, Text as Text15 } from "ink";
import { jsx as jsx15, jsxs as jsxs14 } from "react/jsx-runtime";
function formatTokens(value) {
  const scaled = (next) => next >= 100 ? String(Math.round(next)) : String(Math.round(next * 10) / 10);
  if (value < 1e3) return String(value);
  if (value < 1e6) return `${scaled(value / 1e3)}K`;
  return `${scaled(value / 1e6)}M`;
}
function formatDuration(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1e3);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m${String(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h${String(minutes % 60)}m`;
}
function metricSegments(row) {
  return [
    row.contextPercent === void 0 ? void 0 : `ctx ${String(row.contextPercent)}%`,
    row.tokens === void 0 ? void 0 : `${formatTokens(row.tokens)} tok`,
    row.durationMs === void 0 ? void 0 : formatDuration(row.durationMs),
    row.model
  ].filter((value) => value !== void 0);
}
function aggregateLine(rows) {
  const tokenRows = rows.filter((row) => row.tokens !== void 0);
  const durationRows = rows.filter((row) => row.durationMs !== void 0);
  const known = rows.filter((row) => metricSegments(row).length > 0).length;
  const segments = [
    `\u03A3 \u5B50\u4EE3\u7406 ${String(rows.length)}`,
    tokenRows.length === 0 ? void 0 : `tokens ${formatTokens(tokenRows.reduce((sum, row) => sum + row.tokens, 0))}`,
    durationRows.length === 0 ? void 0 : `\u8017\u65F6 ${formatDuration(durationRows.reduce((sum, row) => sum + row.durationMs, 0))}`,
    `\u5DF2\u77E5 ${String(known)}/${String(rows.length)}`
  ];
  return segments.filter((value) => value !== void 0).join(" \xB7 ");
}
function hubRow(row, selected) {
  const label = [row.label, row.activity === "" ? void 0 : row.activity, ...metricSegments(row)].filter((value) => value !== void 0).join(" \xB7 ");
  return /* @__PURE__ */ jsxs14(Box15, { width: "100%", flexDirection: "column", children: [
    /* @__PURE__ */ jsxs14(Box15, { width: "100%", children: [
      /* @__PURE__ */ jsx15(Text15, { children: selected ? styled(escapeContent("\u203A "), "accent", void 0, true) : "  " }),
      /* @__PURE__ */ jsx15(Text15, { children: paintRow([styled(escapeContent(label), selected ? "fg" : "fgDim")]) })
    ] }),
    /* @__PURE__ */ jsx15(Text15, { children: paintRow([styled(escapeContent(`\u5B50\u4F1A\u8BDD ID \xB7 ${row.id}`), "fgDim")]) })
  ] }, row.id);
}
function AgentHubPane({
  rows = [],
  selectedIndex = 0,
  view = "table",
  error,
  transcript,
  missing = false
}) {
  if (missing) {
    return /* @__PURE__ */ jsx15(
      OverlayShell,
      {
        title: "\u5B50\u4EE3\u7406",
        error: "\u5B50\u4EE3\u7406\u670D\u52A1\u672A\u7EC4\u5408",
        footnote: "Esc \u5173\u95ED"
      }
    );
  }
  if (view === "transcript") {
    if (error !== void 0 && error !== "") {
      return /* @__PURE__ */ jsx15(
        OverlayShell,
        {
          title: "\u5B50\u4EE3\u7406",
          error,
          footnote: "Esc \u8FD4\u56DE\u5217\u8868"
        }
      );
    }
    const lines = (transcript ?? "").split("\n").filter((line5) => line5 !== "");
    return /* @__PURE__ */ jsx15(OverlayShell, { title: "\u5B50\u4EE3\u7406", footnote: "Esc \u8FD4\u56DE", children: lines.map((line5, index) => /* @__PURE__ */ jsx15(Text15, { children: paintRow([styled(escapeContent(line5), "fg")]) }, index)) });
  }
  if (error !== void 0 && error !== "") {
    return /* @__PURE__ */ jsx15(
      OverlayShell,
      {
        title: "\u5B50\u4EE3\u7406",
        error,
        footnote: "Esc \u5173\u95ED \xB7 \u53EF\u91CD\u8BD5"
      }
    );
  }
  if (rows.length === 0) {
    return /* @__PURE__ */ jsx15(
      OverlayShell,
      {
        title: "\u5B50\u4EE3\u7406",
        body: "\u6682\u65E0\u5B50\u4EE3\u7406",
        footnote: "Esc \u5173\u95ED \xB7 \u6709\u8FD0\u884C\u4E2D\u7684\u5B50\u4EE3\u7406\u65F6\u518D\u6253\u5F00"
      }
    );
  }
  const clamped = Math.min(Math.max(selectedIndex, 0), rows.length - 1);
  return /* @__PURE__ */ jsxs14(
    OverlayShell,
    {
      title: "\u5B50\u4EE3\u7406",
      footnote: "j/k \u9009\u62E9 \xB7 Enter \u67E5\u770B \xB7 Esc \u5173\u95ED",
      children: [
        rows.map((row, index) => hubRow(row, index === clamped)),
        /* @__PURE__ */ jsx15(Text15, { children: paintRow([styled(escapeContent(aggregateLine(rows)), "fgDim")]) })
      ]
    }
  );
}

// tui-render/src/plan-directory-pane.tsx
import { Box as Box16, Text as Text16 } from "ink";
import { jsx as jsx16, jsxs as jsxs15 } from "react/jsx-runtime";
var TITLE3 = "\u8BA1\u5212";
var FOOTNOTE3 = "j/k \u9009\u62E9 \xB7 Enter \u5207\u6362 \xB7 Esc \u5173\u95ED";
var SWITCH_NEXT = "\u5F53\u524D\u6A21\u5F0F\u4FDD\u6301\u4E0D\u53D8 \xB7 \u53EF\u91CD\u8BD5";
var STATUS_FOOTNOTE = "Esc \u5173\u95ED \xB7 \u53EF\u91CD\u8BD5";
var ROWS = ["\u5F00\u542F", "\u5173\u95ED"];
var EMPTY_PLAN_DIRECTORY_PANE = {
  open: false,
  selectedIndex: 0,
  currentActive: false
};
function directoryRow(label, selected, current) {
  const text = current ? `${label} \xB7 \u5F53\u524D` : label;
  return /* @__PURE__ */ jsxs15(Box16, { width: "100%", children: [
    /* @__PURE__ */ jsx16(Text16, { children: selected ? styled(escapeContent("\u203A "), "accent", void 0, true) : "  " }),
    /* @__PURE__ */ jsx16(Text16, { children: paintRow([styled(escapeContent(text), selected ? "fg" : "fgDim")]) })
  ] }, label);
}
function line3(text, token) {
  return /* @__PURE__ */ jsx16(Text16, { children: paintRow([styled(escapeContent(text), token)]) });
}
function PlanDirectoryPane({
  selectedIndex = 0,
  currentActive = false,
  switchError,
  statusError
}) {
  if (statusError !== void 0 && statusError !== "") {
    return /* @__PURE__ */ jsx16(
      OverlayShell,
      {
        title: TITLE3,
        error: `\u65E0\u6CD5\u8BFB\u53D6\u8BA1\u5212\u72B6\u6001\uFF1A${statusError}`,
        footnote: STATUS_FOOTNOTE
      }
    );
  }
  return /* @__PURE__ */ jsxs15(OverlayShell, { title: TITLE3, footnote: FOOTNOTE3, children: [
    ROWS.map(
      (label, index) => directoryRow(
        label,
        index === selectedIndex,
        label === "\u5F00\u542F" ? currentActive : !currentActive
      )
    ),
    switchError !== void 0 && switchError !== "" ? /* @__PURE__ */ jsxs15(Box16, { flexDirection: "column", width: "100%", children: [
      line3(`\u2717 \u5207\u6362\u8BA1\u5212\u5931\u8D25\uFF1A${switchError}`, "error"),
      line3(SWITCH_NEXT, "fgDim")
    ] }) : null
  ] });
}

// tui-render/src/plan-review-pane.tsx
import { Box as Box17, Text as Text17 } from "ink";
import { jsx as jsx17, jsxs as jsxs16 } from "react/jsx-runtime";
var TITLE4 = "\u8BA1\u5212\u8BC4\u5BA1";
var FOOTNOTE4 = "y \u6279\u51C6 \xB7 n \u7EE7\u7EED\u89C4\u5212 \xB7 Esc \u53D6\u6D88";
var EMPTY_BODY = "\u8BA1\u5212\u6B63\u6587\u4E3A\u7A7A";
var DELIVERY_NEXT2 = "\u5F53\u524D\u8BA1\u5212\u672A\u6279\u51C6 \xB7 \u53EF\u91CD\u8BD5\u8BE5\u8F6E";
var PLAN_REVIEW_WINDOW = 12;
var EMPTY_PLAN_REVIEW_PANE = {
  open: false
};
function line4(text, token, bold = false) {
  return /* @__PURE__ */ jsx17(Text17, { children: paintRow([styled(escapeContent(text), token, void 0, bold)]) });
}
function PlanReviewPane({
  plan = "",
  offset = 0,
  deliveryError
}) {
  const empty = plan.trim() === "";
  const lines = plan.split("\n");
  const safeOffset = Math.max(0, offset);
  const windowed = lines.slice(safeOffset, safeOffset + PLAN_REVIEW_WINDOW).join("\n");
  return /* @__PURE__ */ jsxs16(Box17, { flexDirection: "column", width: "100%", children: [
    line4(TITLE4, "fg", true),
    deliveryError !== void 0 && deliveryError !== "" ? /* @__PURE__ */ jsxs16(Box17, { flexDirection: "column", width: "100%", children: [
      line4(`\u2717 \u8BA1\u5212\u8BC4\u5BA1\u672A\u80FD\u9001\u8FBE\uFF1A${deliveryError}`, "error"),
      line4(DELIVERY_NEXT2, "fgDim")
    ] }) : empty ? line4(EMPTY_BODY, "fg") : /* @__PURE__ */ jsx17(MarkdownBlock, { source: windowed }),
    line4("\u6279\u51C6", "fg"),
    line4("\u7EE7\u7EED\u89C4\u5212", "fg"),
    line4(FOOTNOTE4, "fgDim")
  ] });
}

// tui-render/src/ask-user-pane.tsx
import { Box as Box18, Text as Text18 } from "ink";
import { jsx as jsx18, jsxs as jsxs17 } from "react/jsx-runtime";
var FOOTNOTE5 = "\u2191\u2193/jk \u79FB\u52A8 \xB7 1-9 \u9009\u62E9 \xB7 Enter \u4F5C\u7B54 \xB7 Esc \u53D6\u6D88\u63D0\u95EE";
var INVALID_TITLE = "\u2717 \u63D0\u95EE\u65E0\u6548";
var INVALID_NEXT = "Esc \u53D6\u6D88";
var EMPTY_ASK_USER_PANE = {
  open: false,
  header: "",
  options: [],
  selectedIndex: 0
};
function AskUserPane({
  header,
  options,
  selectedIndex
}) {
  if (options.length === 0) {
    return /* @__PURE__ */ jsxs17(Box18, { flexDirection: "column", width: "100%", children: [
      renderPaneLine(INVALID_TITLE, "error", true),
      renderPaneLine(INVALID_NEXT, "fgDim")
    ] });
  }
  const footnote = FOOTNOTE5;
  return /* @__PURE__ */ jsxs17(Box18, { flexDirection: "column", width: "100%", children: [
    header !== "" ? renderPaneLine(header, "fg", true) : null,
    /* @__PURE__ */ jsx18(Box18, { flexDirection: "column", marginTop: header !== "" ? 1 : 0, width: "100%", children: options.map((label, index) => {
      const selected = index === selectedIndex;
      const numbered = `${index + 1} ${label}`;
      return /* @__PURE__ */ jsxs17(Box18, { width: "100%", children: [
        /* @__PURE__ */ jsx18(Text18, { children: selected ? paintRow([styled("\u203A ", "accent", void 0, true)]) : "  " }),
        /* @__PURE__ */ jsx18(Text18, { children: paintRow([styled(escapeContent(numbered), selected ? "fg" : "fgDim", void 0, selected)]) })
      ] }, `${index}:${label}`);
    }) }),
    /* @__PURE__ */ jsx18(Box18, { marginTop: 1, width: "100%", children: renderPaneLine(footnote, "fgDim") })
  ] });
}

// tui-render/src/timeline-view.tsx
import { Box as Box19, Text as Text19 } from "ink";
import { jsx as jsx19, jsxs as jsxs18 } from "react/jsx-runtime";
var FIRST_LINE_MAX = 120;
var TIMELINE_WINDOW = 60;
function TimelineView({
  history,
  now,
  offset = 0
}) {
  const clock = now ?? Date.now();
  const maxOffset2 = Math.max(0, history.length - TIMELINE_WINDOW);
  const safeOffset = Math.min(offset, maxOffset2);
  const end = history.length - safeOffset;
  const start = Math.max(0, end - TIMELINE_WINDOW);
  const visible = history.slice(start, end);
  const current = end >= history.length ? visible.length - 1 : -1;
  return /* @__PURE__ */ jsxs18(Box19, { flexDirection: "column", width: "100%", children: [
    history.length === 0 ? /* @__PURE__ */ jsx19(Text19, { dimColor: true, children: "\uFF08\u65E0\u5386\u53F2\u6D88\u606F\uFF09" }) : null,
    start > 0 ? /* @__PURE__ */ jsxs18(Text19, { dimColor: true, children: [
      "\u2026 \u8FD8\u6709 ",
      start,
      " \u6761"
    ] }) : null,
    visible.map((message, index) => /* @__PURE__ */ jsxs18(Box19, { width: "100%", children: [
      /* @__PURE__ */ jsx19(Text19, { dimColor: true, children: relativeTime(message.timestamp, clock) }),
      /* @__PURE__ */ jsxs18(Text19, { dimColor: true, children: [
        " ",
        message.kind === "user" ? "> " : "\u25CF "
      ] }),
      /* @__PURE__ */ jsx19(Text19, { children: index === current ? styled(escapeContent(firstLine(message.text)), "accent") : escapeContent(firstLine(message.text)) })
    ] }, start + index)),
    /* @__PURE__ */ jsx19(Text19, { children: styled(escapeContent("\u2191\u2193/jk \u6EDA\u52A8 \xB7 Esc \u5173\u95ED"), "fgDim") })
  ] });
}
function firstLine(text) {
  const line5 = text.split("\n")[0];
  return line5.length > FIRST_LINE_MAX ? `${line5.slice(0, FIRST_LINE_MAX)}\u2026` : line5;
}

// tui-render/src/input-bar.tsx
import { Box as Box20, Text as Text20, useStdout as useStdout2, useWindowSize as useWindowSize6 } from "ink";
import { useLayoutEffect as useLayoutEffect2 } from "react";

// tui-render/src/composer-cursor.ts
var GRAPHEME3 = new Intl.Segmenter(void 0, { granularity: "grapheme" });
function composerCursorPosition(text, caretIndex) {
  const clamped = Math.max(0, Math.min(caretIndex, text.length));
  const before = text.slice(0, clamped);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  return { row: lines.length - 1, col: displayWidth(lastLine) };
}
function composerLineWindow(text, caretIndex, columns) {
  const safe = (value) => escapeContent(value).replace(/\t/gu, "\\t");
  const escaped = safe(text);
  const caret = caretIndex === void 0 ? 0 : displayWidth(safe(text.slice(0, caretIndex)));
  const hiddenPrefix = caret >= columns;
  const budget = Math.max(1, columns - 1 - (hiddenPrefix ? 1 : 0));
  const desiredStart = Math.max(0, caret - budget);
  let startColumn = 0;
  let startOffset = 0;
  if (desiredStart > 0) for (const part of GRAPHEME3.segment(escaped)) {
    if (startColumn >= desiredStart) break;
    startColumn += displayWidth(part.segment);
    startOffset += part.segment.length;
  }
  return {
    text: wcwidthSafeSlice(escaped.slice(startOffset), budget),
    startColumn,
    caretColumn: caret - startColumn + (hiddenPrefix ? 1 : 0),
    hiddenPrefix
  };
}
function clampCaretIndex(text, caretIndex) {
  if (caretIndex === void 0) return text.length;
  return Math.max(0, Math.min(caretIndex, text.length));
}
function moveCaretByGrapheme(text, caretIndex, direction) {
  const caret = clampCaretIndex(text, caretIndex);
  if (direction < 0) {
    if (caret <= 0) return 0;
    let last = 0;
    let offset = 0;
    for (const part of GRAPHEME3.segment(text.slice(0, caret))) {
      last = offset;
      offset += part.segment.length;
    }
    return last;
  }
  if (caret >= text.length) return text.length;
  for (const part of GRAPHEME3.segment(text.slice(caret))) {
    return caret + part.segment.length;
  }
  return text.length;
}
function moveCaretUpLine(text, caretIndex) {
  const caret = clampCaretIndex(text, caretIndex);
  const prevNewline = text.lastIndexOf("\n", caret - 1);
  if (prevNewline === -1) return void 0;
  const currentLineStart = prevNewline + 1;
  const col = caret - currentLineStart;
  const lineBeforeStart = text.lastIndexOf("\n", prevNewline - 1) + 1;
  const lineBeforeLength = prevNewline - lineBeforeStart;
  return lineBeforeStart + Math.min(col, lineBeforeLength);
}
function moveCaretDownLine(text, caretIndex) {
  const caret = clampCaretIndex(text, caretIndex);
  const nextNewline = text.indexOf("\n", caret);
  if (nextNewline === -1) return void 0;
  const currentLineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const col = caret - currentLineStart;
  let nextLineEnd = text.indexOf("\n", nextNewline + 1);
  if (nextLineEnd === -1) nextLineEnd = text.length;
  const nextLineLength = nextLineEnd - (nextNewline + 1);
  return nextNewline + 1 + Math.min(col, nextLineLength);
}
function composerFrameAnchor(text, caretIndex, options) {
  const caret = composerCursorPosition(text, caretIndex);
  const lineCount = Math.max(1, text.split("\n").length);
  const rowsBelow = Math.max(0, options.rowsBelow ?? 0);
  const lastLineUp = lineCount - 1 - caret.row + rowsBelow;
  const upFromCursor = options.fullscreen ? lastLineUp : lastLineUp + 1;
  return {
    up: Math.max(0, Math.min(upFromCursor, Math.max(0, options.rows - 1))),
    col: Math.max(
      1,
      Math.min(options.promptWidth + caret.col + 1, Math.max(1, options.columns))
    )
  };
}

// tui-render/src/composer-tokens.ts
var IMAGE_TOKEN = /^\[图片 #[1-9]\d*\]/u;
var COMMAND_TOKEN = /^\/[\p{L}\p{N}][\p{L}\p{N}._-]*/u;
var MENTION_TOKEN = /^@\S+/u;
function tokenAt(text, index) {
  const rest = text.slice(index);
  const image = IMAGE_TOKEN.exec(rest)?.[0];
  if (image !== void 0) return Object.freeze({ kind: "image", text: image });
  const boundary = index === 0 || /\s/u.test(text[index - 1] ?? "");
  if (!boundary) return void 0;
  const command = COMMAND_TOKEN.exec(rest)?.[0];
  if (command !== void 0) return Object.freeze({ kind: "command", text: command });
  const mention = MENTION_TOKEN.exec(rest)?.[0];
  if (mention !== void 0) return Object.freeze({ kind: "mention", text: mention });
  return void 0;
}
function tokenizeComposer(text) {
  if (text === "") return Object.freeze([]);
  const tokens = [];
  let ordinaryStart = 0;
  let index = 0;
  while (index < text.length) {
    const token = tokenAt(text, index);
    if (token === void 0) {
      index += 1;
      continue;
    }
    if (ordinaryStart < index) {
      tokens.push(Object.freeze({ kind: "text", text: text.slice(ordinaryStart, index) }));
    }
    tokens.push(token);
    index += token.text.length;
    ordinaryStart = index;
  }
  if (ordinaryStart < text.length) {
    tokens.push(Object.freeze({ kind: "text", text: text.slice(ordinaryStart) }));
  }
  return Object.freeze(tokens);
}

// tui-render/src/input-bar.tsx
import { jsx as jsx20, jsxs as jsxs19 } from "react/jsx-runtime";
var EMPTY_INPUT = {
  text: "",
  commandMode: false,
  mentionMode: false
};
function handleInput(state, event) {
  if (event.input === "return") {
    if (state.commandMode || state.mentionMode) {
      return {
        state: { ...state, commandMode: false, mentionMode: false },
        command: { kind: "cancel" }
      };
    }
    return { state: EMPTY_INPUT, command: { kind: "send", text: state.text } };
  }
  if (event.input === "escape") {
    return {
      state: { ...state, commandMode: false, mentionMode: false },
      command: { kind: "cancel" }
    };
  }
  if (event.input === "/") {
    return {
      state: { ...state, commandMode: true },
      command: { kind: "open-command" }
    };
  }
  if (event.input === "@") {
    return {
      state: { ...state, mentionMode: true },
      command: { kind: "open-mention" }
    };
  }
  if (event.input === "backspace") {
    return {
      state: { ...state, text: state.text.slice(0, -1) },
      command: { kind: "none" }
    };
  }
  return { state, command: { kind: "none" } };
}
var PROMPT_WIDTH = 2;
var COMPOSER_PLACEHOLDER = tuiCopy("inputHint");
function InputBar({
  text,
  commandMode,
  mentionMode,
  rowsBelow = 0,
  caretIndex,
  modelChip,
  modeChip,
  locale
}) {
  const { stdout } = useStdout2();
  const { columns, rows } = useWindowSize6();
  const lines = text.split("\n");
  const caret = Math.max(0, Math.min(caretIndex ?? text.length, text.length));
  const caretLine = text.slice(0, caret).split("\n").length - 1;
  const caretLineStart = caret === 0 ? 0 : text.lastIndexOf("\n", caret - 1) + 1;
  const windows = lines.map((line5, index) => composerLineWindow(
    line5,
    index === caretLine ? caret - caretLineStart : void 0,
    Math.max(1, columns - 4)
  ));
  const anchor = composerFrameAnchor(text, caretIndex ?? text.length, {
    promptWidth: 2 + PROMPT_WIDTH,
    columns,
    rows,
    fullscreen: stdout.isTTY,
    rowsBelow
  });
  const caretRow = Math.max(1, rows - anchor.up);
  const caretWindow = windows[caretLine];
  const caretCol = Math.min(columns, 5 + caretWindow.caretColumn);
  setFrameCaret({ row: caretRow, col: caretCol });
  useLayoutEffect2(() => {
    if (!stdout.isTTY) return;
    setFrameCaret({ row: caretRow, col: caretCol });
    stdout.write(`\x1B[${caretRow};${caretCol}H\x1B[?25h`);
  }, [caretRow, caretCol, stdout]);
  useLayoutEffect2(() => {
    return () => {
      hideFrameCaret();
    };
  }, []);
  const chipText = modeChip && modelChip ? `${modeChip} \xB7 ${modelChip}` : modeChip ?? modelChip ?? "";
  const leftPrefix = "\u2502 ";
  const placeholder = tuiCopy("inputHint", locale);
  const sendHint = tuiCopy("sendHint", locale);
  const leftHint = `\u203A ${placeholder} \xB7 ${sendHint}`;
  const leftWidth = displayWidth(leftPrefix + leftHint);
  const chipWidth = chipText !== "" ? displayWidth(chipText) : 0;
  const canFitChip = chipWidth > 0 && leftWidth + chipWidth + 2 <= columns;
  const headerParts = [
    styled(escapeContent(leftPrefix), "accentText"),
    styled(escapeContent(`\u203A ${placeholder}`), "fg"),
    styled(escapeContent(` \xB7 ${sendHint}`), "fgDim"),
    ...canFitChip ? [
      " ".repeat(Math.max(1, columns - leftWidth - chipWidth)),
      styled(escapeContent(chipText), "fgDim")
    ] : []
  ];
  return /* @__PURE__ */ jsxs19(
    Box20,
    {
      flexDirection: "column",
      width: "100%",
      backgroundColor: inkColor("inputBg"),
      children: [
        /* @__PURE__ */ jsx20(Text20, { wrap: "truncate", children: paintBackgroundRow(headerParts, "inputBg", columns) }),
        lines.map((line5, lineIndex) => {
          const window = windows[lineIndex];
          let sourceColumn = 0;
          const endColumn = window.startColumn + displayWidth(window.text);
          const tokenParts = tokenizeComposer(line5).map((token) => {
            const safe = escapeContent(token.text).replace(/\t/gu, "\\t");
            const width = displayWidth(safe);
            const visible = displayColumnSlice(
              safe,
              Math.max(0, window.startColumn - sourceColumn),
              Math.min(width, endColumn - sourceColumn)
            );
            sourceColumn += width;
            return styled(visible, token.kind === "command" || token.kind === "mention" ? "accent" : token.kind === "image" ? "fgDim" : "fg");
          });
          const last = lineIndex === lines.length - 1;
          return /* @__PURE__ */ jsx20(Text20, { wrap: "truncate", children: paintBackgroundRow([
            styled(escapeContent("\u2502 "), "accentText"),
            styled(escapeContent(lineIndex === 0 ? "> " : "  "), "accentText"),
            ...window.hiddenPrefix ? [styled("\u2039", "fgDim")] : [],
            ...tokenParts,
            ...last && commandMode ? [styled(escapeContent(" /"), "fgDim")] : [],
            ...last && mentionMode ? [styled(escapeContent(" @"), "fgDim")] : []
          ], "inputBg", columns) }, lineIndex);
        })
      ]
    }
  );
}

// tui-render/src/command-menu.tsx
import { Box as Box21, Text as Text21, useWindowSize as useWindowSize7 } from "ink";
import { jsx as jsx21 } from "react/jsx-runtime";
var COMMAND_MENU_WINDOW = 8;
var MARKER_COLS2 = 2;
var NAME_GAP = 2;
var DESC_ELLIPSIS = "\u2026";
function filterCommands(items, query) {
  const needle = query.toLowerCase();
  if (needle === "") return [...items];
  return items.filter((item) => item.name.toLowerCase().startsWith(needle));
}
function completeFirst(items, query) {
  return filterCommands(items, query)[0];
}
function moveSelectionIndex(selectedIndex, delta, itemCount) {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(selectedIndex + delta, itemCount - 1));
}
function completeSelected(items, query, selectedIndex) {
  const matches = filterCommands(items, query);
  return matches[moveSelectionIndex(selectedIndex, 0, matches.length)];
}
function resolveEnterQuery(items, query, selectedIndex = 0) {
  if (query === "") return completeSelected(items, query, selectedIndex)?.name ?? query;
  const space = query.indexOf(" ");
  const head = space === -1 ? query : query.slice(0, space);
  const tail = space === -1 ? "" : query.slice(space);
  if (head === "") return query;
  const completed = completeSelected(items, head, selectedIndex);
  if (completed === void 0) return query;
  return `${completed.name}${tail}`;
}
function fitText(text, maxCols) {
  if (maxCols <= 0) return "";
  if (displayWidth(text) <= maxCols) return text;
  const ellipsisWidth = displayWidth(DESC_ELLIPSIS);
  const budget = maxCols - ellipsisWidth;
  if (budget <= 0) return wcwidthSafeSlice(DESC_ELLIPSIS, maxCols);
  return `${wcwidthSafeSlice(text, budget)}${DESC_ELLIPSIS}`;
}
function paletteRow(item, selected, nameCols, columns) {
  const marker = selected ? styled(escapeContent("\u203A "), "accent", void 0, true) : "  ";
  const name = escapeContent(`/${item.name}`);
  const pad = Math.max(0, nameCols - displayWidth(name));
  const used = MARKER_COLS2 + nameCols + NAME_GAP;
  const desc = fitText(escapeContent(item.description), Math.max(0, columns - used));
  return [
    marker,
    styled(`${name}${" ".repeat(pad)}`, selected ? "fg" : "fgDim"),
    styled(" ".repeat(NAME_GAP), "bg"),
    ...desc === "" ? [] : [styled(desc, "fgDim")]
  ];
}
function CommandMenu({
  items,
  query,
  selectedIndex = 0
}) {
  const { columns } = useWindowSize7();
  const width = conversationWidth(columns > 0 ? columns : 80);
  const allMatches = filterCommands(items, query);
  const clampedIndex = moveSelectionIndex(selectedIndex, 0, allMatches.length);
  const offset = Math.max(0, clampedIndex - COMMAND_MENU_WINDOW + 1);
  const matches = allMatches.slice(offset, offset + COMMAND_MENU_WINDOW);
  if (matches.length === 0) return null;
  let nameCols = 0;
  for (const item of matches) {
    const widthName = displayWidth(`/${item.name}`);
    if (widthName > nameCols) nameCols = widthName;
  }
  return /* @__PURE__ */ jsx21(Box21, { flexDirection: "column", alignItems: "center", width: "100%", children: /* @__PURE__ */ jsx21(Box21, { flexDirection: "column", width, children: matches.map((item, index) => /* @__PURE__ */ jsx21(Box21, { width: "100%", children: /* @__PURE__ */ jsx21(Text21, { children: paintRow(paletteRow(item, offset + index === clampedIndex, nameCols, width)) }) }, item.name)) }) });
}

// tui-render/src/mention.tsx
import { Box as Box22, Text as Text22, useWindowSize as useWindowSize8 } from "ink";
import { jsx as jsx22, jsxs as jsxs20 } from "react/jsx-runtime";
var KIND_LABELS = {
  file: "\u6587\u4EF6",
  directory: "\u76EE\u5F55",
  skill: "\u6280\u80FD",
  subagent: "\u5B50\u4EE3\u7406"
};
function normalizeMentionInsertion(candidate) {
  return (candidate.target ?? `@${candidate.name}`).replace(/\s+$/u, "") + " ";
}
function Mention({
  phase,
  candidates,
  selectedIndex
}) {
  const { columns } = useWindowSize8();
  const width = conversationWidth(columns > 0 ? columns : 80);
  if (phase === "loading") {
    return /* @__PURE__ */ jsx22(Box22, { width: "100%", alignItems: "center", children: /* @__PURE__ */ jsx22(Box22, { width, children: /* @__PURE__ */ jsx22(Text22, { dimColor: true, children: "\u52A0\u8F7D\u4E2D\u2026" }) }) });
  }
  if (candidates.length === 0) {
    return /* @__PURE__ */ jsx22(Box22, { width: "100%", alignItems: "center", children: /* @__PURE__ */ jsx22(Box22, { width, children: /* @__PURE__ */ jsx22(Text22, { dimColor: true, children: "\u65E0\u5339\u914D" }) }) });
  }
  const clampedIndex = Math.max(0, Math.min(selectedIndex, candidates.length - 1));
  const sections = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    const bucket = sections.get(candidate.kind);
    if (bucket === void 0) {
      sections.set(candidate.kind, [candidate]);
    } else {
      bucket.push(candidate);
    }
  }
  const rows = [];
  let rowIndex = 0;
  for (const [kind, group] of sections) {
    rows.push(
      /* @__PURE__ */ jsx22(Box22, { children: /* @__PURE__ */ jsx22(Text22, { dimColor: true, children: KIND_LABELS[kind] }) }, kind)
    );
    for (const candidate of group) {
      const selected = rowIndex === clampedIndex;
      rows.push(
        /* @__PURE__ */ jsxs20(Box22, { children: [
          /* @__PURE__ */ jsx22(Text22, { children: selected ? styled(escapeContent("\u203A "), "accent", void 0, true) : "  " }),
          /* @__PURE__ */ jsxs20(Text22, { dimColor: !selected, children: [
            "@ ",
            escapeContent(candidate.name)
          ] }),
          candidate.description !== void 0 ? /* @__PURE__ */ jsxs20(Text22, { dimColor: true, children: [
            " \u2014 ",
            escapeContent(candidate.description)
          ] }) : null
        ] }, `${kind}:${candidate.name}`)
      );
      rowIndex += 1;
    }
  }
  return /* @__PURE__ */ jsx22(Box22, { flexDirection: "column", alignItems: "center", width: "100%", children: /* @__PURE__ */ jsx22(Box22, { flexDirection: "column", width, children: rows }) });
}

// tui-render/src/goal-footer.ts
function goalFooterHead(goal) {
  return `\u76EE\u6807 ${goal.phase} ${goal.roundsStarted}/${goal.maxGoalRounds}`;
}
function goalFooterRuns(goal, maxObjectiveCols) {
  if (goal === void 0 || goal === null) return void 0;
  return {
    head: escapeContent(goalFooterHead(goal)),
    objective: truncateDisplay(escapeContent(goal.objective), maxObjectiveCols)
  };
}
function formatGoalFooter(goal, maxObjectiveCols) {
  const runs = goalFooterRuns(goal, maxObjectiveCols);
  return runs === void 0 ? void 0 : `${runs.head} \xB7 ${runs.objective}`;
}

// tui-render/src/adaptive-info-footer.ts
function segment(text, token) {
  return { runs: [{ text, token }] };
}
function segmentText(value) {
  return value.runs.map((run) => run.text).join("");
}
function segmentsText(values) {
  return values.map(segmentText).join(" \xB7 ");
}
function fitSegments(values, columns) {
  const selected = [];
  for (const value of values) {
    if (selected.length === 0 || displayWidth(`${segmentsText(selected)} \xB7 ${segmentText(value)}`) <= columns) {
      selected.push(value);
    }
  }
  return selected;
}
function flattenSegments(values, columns) {
  const runs = [];
  for (const [index, value] of values.entries()) {
    if (index > 0) runs.push({ text: " \xB7 ", token: "fgDim" });
    runs.push(...value.runs);
  }
  const text = runs.map((run) => run.text).join("");
  if (displayWidth(text) <= columns) {
    return Object.freeze(runs.map((run) => Object.freeze({ ...run })));
  }
  return Object.freeze([
    Object.freeze({ text: truncateDisplay(text, columns), token: "fgDim" })
  ]);
}
function statusToken(status) {
  if (status === "\u7A7A\u95F2" || status === "idle") return "fgDim";
  if (/失败|错误|error|failed/iu.test(status)) return "error";
  if (/重试|retry/iu.test(status)) return "warning";
  return "accentText";
}
function retryText(retry, locale) {
  const attempt = retry.maxRetries === void 0 ? String(retry.retry) : `${String(retry.retry)}/${String(retry.maxRetries)}`;
  const seconds = Math.max(0, Math.ceil(retry.remainingMs / 1e3));
  return `${tuiCopy("retry", locale)} ${attempt} \xB7 ${String(seconds)}s \xB7 ${escapeContent(retry.failureCode)}`;
}
function workspaceSegments(view, columns) {
  const status = escapeContent(view.status);
  const statusDisplay = view.spinner !== void 0 && view.spinner !== "" ? `${view.spinner} ${status}` : status;
  const statusSegment = segment(`${tuiCopy("status", view.locale)} ${statusDisplay}`, statusToken(status));
  let selected = [statusSegment];
  if (view.environment !== void 0) {
    const environment = segment(escapeContent(view.environment), "fgSoft");
    if (displayWidth(segmentsText([environment, statusSegment])) <= columns) {
      selected = [environment, statusSegment];
    }
  }
  if (view.gitBranch !== void 0 && view.gitBranch !== "") {
    const git = segment(`git: ${escapeContent(view.gitBranch)}`, "accentText");
    const first = selected[0];
    const candidate = selected.length > 1 && first !== void 0 ? [first, git, ...selected.slice(1)] : [...selected, git];
    if (displayWidth(segmentsText(candidate)) <= columns) {
      selected = candidate;
    }
  }
  if (view.retry !== void 0) {
    const retry = segment(retryText(view.retry, view.locale), "warning");
    if (displayWidth(segmentsText([...selected, retry])) <= columns) selected.push(retry);
  }
  if (view.provider !== "") {
    const provider = segment(escapeContent(view.provider), "fgDim");
    if (displayWidth(segmentsText([...selected, provider])) <= columns) selected.push(provider);
  }
  if (displayWidth(segmentsText(selected)) <= columns) return selected;
  return [segment(truncateDisplay(segmentText(statusSegment), columns), statusToken(status))];
}
function contextSegments(pressure, locale) {
  const label = tuiCopy("context", locale);
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens;
  if (used === void 0) return [];
  const contextWindow = pressure?.contextWindow;
  if (contextWindow === void 0 || contextWindow <= 0) {
    return [segment(`${label} ${String(used)}`, "fg")];
  }
  const percent = Math.max(0, Math.min(100, Math.round(used / contextWindow * 100)));
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return [
    {
      runs: [
        { text: `${label} [`, token: "fg" },
        { text: "\u2588".repeat(filled), token: "accentText" },
        { text: "\u2591".repeat(10 - filled), token: "fgDim" },
        { text: `] ${String(percent)}%`, token: "fg" }
      ]
    },
    segment(`${label} ${String(percent)}%`, "fg"),
    segment(`${label} ${String(used)}/${String(contextWindow)}`, "fg")
  ];
}
function promptTokenCount(usage) {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}
function cacheHitSegment(view) {
  const usage = view.tokenUsage;
  if (usage === void 0) return void 0;
  const cacheHit = formatCacheHitPercent(usage.cacheReadTokens, promptTokenCount(usage));
  return cacheHit === null ? void 0 : {
    runs: [
      { text: `${tuiCopy("cacheHit", view.locale)} `, token: "fgDim" },
      { text: `${cacheHit}%`, token: "fgSoft" }
    ]
  };
}
function usageSegments(view) {
  const usage = view.tokenUsage;
  if (usage === void 0) return [];
  const cacheHit = cacheHitSegment(view);
  return [
    segment(`\u2191${String(promptTokenCount(usage))}`, "fgDim"),
    segment(`\u2193${String(usage.outputTokens)}`, "fgDim"),
    ...cacheHit === void 0 ? [] : [cacheHit]
  ];
}
function metricsSegments(view, columns) {
  const effortText = view.effort !== void 0 && view.effort !== "" ? `${tuiCopy("effort", view.locale)} ${escapeContent(view.effort)}` : view.reasoningVisible !== void 0 ? `${tuiCopy("reasoning", view.locale)} ${tuiCopy(view.reasoningVisible ? "on" : "off", view.locale)}` : void 0;
  const effort = effortText === void 0 ? void 0 : segment(effortText, "fgDim");
  const usage = usageSegments(view);
  const contextVariants = contextSegments(view.contextPressure, view.locale);
  const fixed = effort === void 0 ? [] : [effort];
  if (contextVariants.length === 0) {
    return fitSegments([...fixed, ...usage], columns);
  }
  for (const context2 of contextVariants) {
    const candidate = [context2, ...usage, ...fixed];
    if (displayWidth(segmentsText(candidate)) <= columns) return candidate;
  }
  const context = contextVariants.find((value) => displayWidth(segmentText(value)) <= columns);
  return fitSegments([...context === void 0 ? contextVariants.slice(-1) : [context], ...usage, ...fixed], columns);
}
function freezeRow(kind, values, columns) {
  return Object.freeze({ kind, runs: flattenSegments(values, columns) });
}
function formatAdaptiveInfoFooterRows(view, columns, maxRows = 3) {
  const width = Math.max(1, columns);
  const budget = Math.max(1, Math.min(3, Math.floor(maxRows)));
  const rows = [
    freezeRow("workspace", workspaceSegments(view, width), width)
  ];
  if (budget >= 2) {
    const metrics = metricsSegments(view, width);
    if (metrics.length > 0) rows.push(freezeRow("metrics", metrics, width));
  }
  const tip = view.tip === void 0 ? "" : escapeContent(view.tip);
  if (budget >= 3 && tip !== "") {
    rows.push(freezeRow("operations", [segment(truncateDisplay(tip, width), "fgDim")], width));
  }
  return Object.freeze(rows);
}
function formatAdaptiveInfoFooter(view, columns, maxRows = 3) {
  return Object.freeze(formatAdaptiveInfoFooterRows(view, columns, maxRows).map((row) => row.runs.map((run) => run.text).join("")));
}
function formatCompactTokens(count) {
  if (count >= 1e6) {
    const val = count / 1e6;
    return `${val >= 10 || count % 1e6 === 0 ? Math.round(val) : val.toFixed(1)}M`;
  }
  if (count >= 1e3) {
    const val = count / 1e3;
    return `${val >= 10 || count % 1e3 === 0 ? Math.round(val) : val.toFixed(1)}K`;
  }
  return String(count);
}
function formatQuietStatusRow(view, columns) {
  const width = Math.max(1, columns);
  const join2 = view.locale === "en-US" ? " " : "";
  const leftCompact = `Ctrl+O ${tuiCopy("reasoning", view.locale)}${join2}${tuiCopy(view.reasoningVisible === true ? "on" : "off", view.locale)}`;
  const leftDefault = `${leftCompact} \xB7 /status ${tuiCopy("metrics", view.locale)}`;
  const leftText = view.tip && view.tip !== "" ? escapeContent(view.tip) : leftDefault;
  const critical = [];
  const status = escapeContent(view.status);
  const statusDisplay = view.spinner !== void 0 && view.spinner !== "" ? `${view.spinner} ${status}` : status;
  if (status !== "") critical.push(segment(statusDisplay, statusToken(status)));
  if (view.retry !== void 0) critical.push(segment(retryText(view.retry, view.locale), "warning"));
  const contexts = [...contextSegments(view.contextPressure, view.locale)];
  const pressure = view.contextPressure;
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens;
  const contextWindow = pressure?.contextWindow;
  const meter = contexts[0];
  if (used !== void 0 && contextWindow !== void 0 && contextWindow > 0 && meter !== void 0) {
    contexts.unshift({ runs: [
      ...meter.runs,
      { text: ` ${formatCompactTokens(used)}/${formatCompactTokens(contextWindow)}`, token: "fgDim" }
    ] });
  }
  const cache2 = cacheHitSegment(view);
  const reservedLeft = width >= 80 ? displayWidth(leftCompact) + 1 : 0;
  const rightBudget = Math.max(displayWidth(segmentsText(critical)), width - reservedLeft);
  let selected = critical;
  const candidates = (cache2 === void 0 ? [void 0] : [cache2, void 0]).flatMap((hit) => [...contexts, void 0].map((context) => [
    ...context === void 0 ? [] : [context],
    ...hit === void 0 ? [] : [hit],
    ...critical
  ]));
  for (const candidate of candidates) {
    if (displayWidth(segmentsText(candidate)) <= rightBudget) {
      selected = candidate;
      break;
    }
  }
  const rightParts = flattenSegments(selected, width);
  const rightText = rightParts.map((r) => r.text).join("");
  const rightWidth = displayWidth(rightText);
  if (rightWidth >= width) {
    return Object.freeze({
      kind: "workspace",
      runs: Object.freeze([
        Object.freeze({ text: truncateDisplay(rightText, width), token: "fgDim" })
      ])
    });
  }
  const availableForLeft = width - rightWidth - 1;
  if (availableForLeft >= 10) {
    const fittedLeft = view.tip && view.tip !== "" ? truncateDisplay(leftText, availableForLeft) : [leftDefault, leftCompact].find((text) => displayWidth(text) <= availableForLeft) ?? "";
    const spaces = Math.max(1, width - displayWidth(fittedLeft) - rightWidth);
    return Object.freeze({
      kind: "workspace",
      runs: Object.freeze([
        Object.freeze({ text: fittedLeft, token: "fgDim" }),
        Object.freeze({ text: " ".repeat(spaces), token: "fgDim" }),
        ...rightParts.map((r) => Object.freeze({ ...r }))
      ])
    });
  }
  return Object.freeze({
    kind: "workspace",
    runs: Object.freeze(rightParts.map((r) => Object.freeze({ ...r })))
  });
}

// tui-render/src/git-branch.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
var branchCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 2e3;
function detectGitBranch(cwd) {
  if (!cwd) return void 0;
  const now = Date.now();
  const cached = branchCache.get(cwd);
  if (cached !== void 0 && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.branch;
  }
  let branch;
  try {
    let dir = cwd;
    while (dir) {
      const gitPath = join(dir, ".git");
      if (existsSync(gitPath)) {
        let headPath;
        const stat = statSync(gitPath);
        if (stat.isDirectory()) {
          headPath = join(gitPath, "HEAD");
        } else if (stat.isFile()) {
          const gitContent = readFileSync(gitPath, "utf8");
          const match = /gitdir:\s*(.+)/u.exec(gitContent);
          if (match?.[1]) {
            const gitDir = match[1].trim();
            headPath = join(dir, gitDir, "HEAD");
          }
        }
        if (headPath && existsSync(headPath)) {
          const head = readFileSync(headPath, "utf8").trim();
          if (head.startsWith("ref: refs/heads/")) {
            branch = head.slice("ref: refs/heads/".length);
          } else if (/^[0-9a-f]{7,40}$/iu.test(head)) {
            branch = head.slice(0, 7);
          }
        }
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    branch = void 0;
  }
  branchCache.set(cwd, { branch, timestamp: now });
  return branch;
}

// tui-render/src/todo-hud.tsx
import { Text as Text23 } from "ink";
import { Fragment as Fragment2, jsx as jsx23 } from "react/jsx-runtime";
var STATUS_PRESENTATION = {
  pending: { glyph: "\xB7", word: "\u5F85\u529E", token: "fgDim" },
  in_progress: { glyph: "\u25B8", word: "\u8FDB\u884C\u4E2D", token: "accent" },
  completed: { glyph: "\u2713", word: "\u5B8C\u6210", token: "success" }
};
function TodoHud({
  todos,
  maxCols,
  limit = 5
}) {
  const safeLimit = Math.max(0, limit);
  const incomplete = todos.filter((todo) => todo.status !== "completed");
  const visible = safeLimit === 0 ? [] : incomplete.slice(-safeLimit);
  if (visible.length === 0) return null;
  return /* @__PURE__ */ jsx23(Fragment2, { children: visible.map((todo, index) => {
    const presentation = STATUS_PRESENTATION[todo.status];
    const head = `${presentation.glyph} ${presentation.word} `;
    const contentToken = todo.status === "in_progress" ? "fgSoft" : "fgDim";
    return /* @__PURE__ */ jsx23(Text23, { wrap: "truncate", children: paintRow([
      styled(escapeContent(head), presentation.token),
      styled(
        truncateDisplay(
          escapeContent(todo.content),
          Math.max(1, maxCols - displayWidth(head))
        ),
        contentToken
      )
    ]) }, index);
  }) });
}

// tui-render/src/jobs-hud.tsx
import { Text as Text24 } from "ink";
import { Fragment as Fragment3, jsx as jsx24 } from "react/jsx-runtime";
function JobsHud({
  jobs,
  maxCols
}) {
  if (jobs.length === 0) return null;
  return /* @__PURE__ */ jsx24(Fragment3, { children: jobs.map((job) => {
    const rowText = `${job.id} \xB7 ${job.status} \xB7 ${job.label}`;
    const statusToken2 = job.status === "running" ? "accentText" : job.status === "failed" || job.status === "killed" ? "error" : "fgDim";
    return /* @__PURE__ */ jsx24(Text24, { wrap: "truncate", children: paintRow([
      styled(
        truncateDisplay(escapeContent(rowText), maxCols),
        statusToken2
      )
    ]) }, job.id);
  }) });
}

// tui-render/src/workflow-hud.tsx
import { Text as Text25 } from "ink";
import { Fragment as Fragment4, jsx as jsx25 } from "react/jsx-runtime";
function WorkflowHud({
  run,
  maxCols
}) {
  if (run === void 0) return null;
  const rows = [];
  if (run.phase !== void 0 && run.phase !== "") {
    const head = "\u9636\u6BB5 ";
    rows.push(
      /* @__PURE__ */ jsx25(Text25, { wrap: "truncate", children: paintRow([
        styled(escapeContent(head), "fgDim"),
        styled(
          truncateDisplay(escapeContent(run.phase), Math.max(1, maxCols - displayWidth(head))),
          "fgDim"
        )
      ]) }, "phase")
    );
  }
  if (run.current !== void 0) {
    const member = run.current;
    const outcomeSuffix = member.outcome === void 0 ? "" : ` \xB7 ${member.outcome}`;
    rows.push(
      /* @__PURE__ */ jsx25(Text25, { wrap: "truncate", children: paintRow([
        styled(
          truncateDisplay(
            escapeContent(`${member.seq} \xB7 ${member.label}${outcomeSuffix}`),
            maxCols
          ),
          "fgDim"
        )
      ]) }, "member")
    );
  }
  return rows.length === 0 ? null : /* @__PURE__ */ jsx25(Fragment4, { children: rows });
}

// tui-render/src/workflow-overlay.tsx
import { Text as Text26 } from "ink";
import { jsx as jsx26 } from "react/jsx-runtime";
var WORKFLOW_OVERLAY_WINDOW = 8;
var EMPTY_WORKFLOW_OVERLAY = { open: false, offset: 0 };
function WorkflowOverlay({
  state
}) {
  if (!state.open) return null;
  if (state.error !== void 0) {
    return /* @__PURE__ */ jsx26(OverlayShell, { title: "\u5DE5\u4F5C\u6D41", error: state.error, footnote: "Esc \u5173\u95ED" });
  }
  if (state.run === void 0) {
    return /* @__PURE__ */ jsx26(OverlayShell, { title: "\u5DE5\u4F5C\u6D41", body: "\u5F53\u524D\u65E0\u5DE5\u4F5C\u6D41\u8FD0\u884C", footnote: "Esc \u5173\u95ED" });
  }
  const rows = [];
  if (state.run.phase !== void 0 && state.run.phase !== "") {
    rows.push(
      /* @__PURE__ */ jsx26(Text26, { children: paintRow([styled(escapeContent(`\u9636\u6BB5 ${state.run.phase}`), "fg")]) }, "phase")
    );
  }
  const windowed = state.run.members.slice(
    state.offset,
    state.offset + WORKFLOW_OVERLAY_WINDOW
  );
  for (const member of windowed) {
    const outcomeSuffix = member.outcome === void 0 ? "" : ` \xB7 ${member.outcome}`;
    rows.push(
      /* @__PURE__ */ jsx26(Text26, { children: paintRow([
        styled(escapeContent(`${member.seq} \xB7 ${member.label}${outcomeSuffix}`), "fgDim")
      ]) }, member.seq)
    );
  }
  return /* @__PURE__ */ jsx26(OverlayShell, { title: "\u5DE5\u4F5C\u6D41", footnote: "j/k \u6EDA\u52A8 \xB7 Esc \u5173\u95ED", children: rows });
}

// tui-render/src/workspace-pane.tsx
import { Text as Text27 } from "ink";
import { jsx as jsx27 } from "react/jsx-runtime";
var EMPTY_WORKSPACE_PANE = {
  open: false,
  root: "",
  nodes: [],
  selectedIndex: 0,
  editing: false
};
var RESOLVE_FAIL_NEXT = "\u5F53\u524D\u8DEF\u5F84\u4FDD\u6301\u4E0D\u53D8 \xB7 \u53EF\u91CD\u8BD5";
function WorkspacePane({
  state,
  maxCols
}) {
  if (!state.open) return null;
  if (state.error !== void 0) {
    return /* @__PURE__ */ jsx27(OverlayShell, { title: "\u5DE5\u4F5C\u533A", error: state.error, footnote: "Esc \u5173\u95ED" });
  }
  const footnote = state.editing ? "Enter \u89E3\u6790 \xB7 Esc \u53D6\u6D88" : state.nodes.length === 0 ? "e \u8F93\u5165\u8DEF\u5F84 \xB7 Esc \u5173\u95ED" : "j/k \u9009\u62E9 \xB7 Enter \u6253\u5F00 \xB7 e \u8DEF\u5F84 \xB7 Esc \u5173\u95ED";
  const rows = [];
  state.nodes.forEach((node, index) => {
    const glyph = node.kind === "directory" ? node.expanded ? "\u25BE" : "\u25B8" : " ";
    const selected = index === state.selectedIndex && !state.editing;
    const head = `${selected ? "\u203A " : "  "}${"  ".repeat(node.depth)}${glyph} `;
    rows.push(
      /* @__PURE__ */ jsx27(Text27, { wrap: "truncate", children: paintRow([
        styled(escapeContent(head), selected ? "accent" : "fgDim"),
        styled(
          truncateDisplay(
            escapeContent(node.name),
            Math.max(1, maxCols - displayWidth(head))
          ),
          selected ? "fg" : "fgDim"
        )
      ]) }, node.path)
    );
  });
  return /* @__PURE__ */ jsx27(
    OverlayShell,
    {
      title: "\u5DE5\u4F5C\u533A",
      body: state.nodes.length === 0 ? "\u6B64\u76EE\u5F55\u4E3A\u7A7A" : void 0,
      footnote,
      error: state.resolveError === void 0 ? void 0 : `\u8DEF\u5F84\u65E0\u6548\uFF1A${state.resolveError}`,
      errorNext: state.resolveError === void 0 ? void 0 : RESOLVE_FAIL_NEXT,
      children: rows
    }
  );
}

// tui-render/src/feedback-pane.tsx
import { Text as Text28 } from "ink";
import { jsx as jsx28 } from "react/jsx-runtime";
var EMPTY_FEEDBACK_PANE = {
  open: false,
  hasTarget: false,
  editing: false
};
var WRITE_FAILURE_COPY = {
  "write-failure": { next: "\u5F53\u524D\u8BC4\u5206\u4FDD\u6301\u4E0D\u53D8 \xB7 \u53EF\u91CD\u8BD5" },
  "version-conflict": { next: "\u5DF2\u5237\u65B0\u5F53\u524D\u7248\u672C \xB7 \u53EF\u91CD\u8BD5" },
  "note-too-large": { next: "\u7F29\u77ED\u540E Enter \u518D\u5199\u5165 \xB7 Esc \u53D6\u6D88\u7F16\u8F91" }
};
function FeedbackPane({
  state
}) {
  if (!state.open) return null;
  if (state.error !== void 0) {
    return /* @__PURE__ */ jsx28(OverlayShell, { title: "\u53CD\u9988", error: state.error, footnote: "Esc \u5173\u95ED" });
  }
  if (!state.hasTarget) {
    return /* @__PURE__ */ jsx28(
      OverlayShell,
      {
        title: "\u53CD\u9988",
        body: "\u6682\u65E0\u52A9\u624B\u6D88\u606F\u53EF\u53CD\u9988",
        footnote: "\u7B49\u5F85\u52A9\u624B\u56DE\u590D\u540E\u518D\u6253\u5F00 \xB7 Esc \u5173\u95ED"
      }
    );
  }
  const writeError = state.writeError;
  const errorText = writeError === void 0 ? void 0 : writeError === "write-failure" ? `\u53CD\u9988\u672A\u80FD\u5199\u5165\uFF1A${state.writeErrorReason ?? ""}` : writeError === "version-conflict" ? "\u7248\u672C\u51B2\u7A81" : "\u5907\u6CE8\u8FC7\u957F";
  const rows = [
    { key: "positive", label: "\u8D5E" },
    { key: "negative", label: "\u8E29" }
  ].map((row) => /* @__PURE__ */ jsx28(Text28, { children: paintRow([
    styled(
      escapeContent(`${row.label}${state.rating === row.key ? " \xB7 \u5F53\u524D" : ""}`),
      state.rating === row.key ? "fg" : "fgDim"
    )
  ]) }, row.key));
  return /* @__PURE__ */ jsx28(
    OverlayShell,
    {
      title: "\u53CD\u9988",
      footnote: state.editing ? "Enter \u5199\u5165 \xB7 Esc \u53D6\u6D88" : "l \u8D5E \xB7 d \u8E29 \xB7 e \u5907\u6CE8 \xB7 Esc \u5173\u95ED",
      error: errorText,
      errorNext: writeError === void 0 ? void 0 : WRITE_FAILURE_COPY[writeError].next,
      children: rows
    }
  );
}

// tui-render/src/keymap.ts
var KEYMAP = [
  { key: "return", action: "send" },
  { key: "return", shift: true, action: "newline" },
  { key: "tab", shift: true, action: "cycle-mode" },
  { key: "c", ctrl: true, action: "stop-generation" },
  { key: "o", ctrl: true, action: "toggle-reasoning" },
  { key: "e", ctrl: true, action: "toggle-tool-cards" },
  { key: "y", ctrl: true, action: "copy-message" },
  { key: "p", ctrl: true, action: "intake-clipboard-image" },
  { key: "g", ctrl: true, action: "edit-external" },
  { key: "k", ctrl: true, action: "toggle-compaction-divider" },
  { key: "j", action: "scroll-down" },
  { key: "k", action: "scroll-up" },
  { key: "/", action: "command-menu" },
  { key: "@", action: "mention" },
  { key: "escape", action: "cancel" }
];
function keyActionFor(key, modifiers) {
  return KEYMAP.find(
    (binding) => binding.key === key && (binding.ctrl ?? false) === modifiers.ctrl && (binding.shift ?? false) === modifiers.shift
  )?.action;
}
function toolDetailsKeyAction(key, info) {
  if (info.ctrl) return void 0;
  if (info.escape) return "back";
  if (info.return) return "select";
  if (info.upArrow || key === "k") return "up";
  if (info.downArrow || key === "j") return "down";
  if (info.leftArrow || info.pageUp || key === "p") return "previous";
  if (info.rightArrow || info.pageDown || key === "n") return "next";
  if (key === "d") return "diagnostics";
  if (key === "y") return "copy";
  if (key === "e") return "export";
  return void 0;
}

// tui-render/src/tool-details-pane.tsx
import { Box as Box23, Text as Text29 } from "ink";
import { jsx as jsx29, jsxs as jsxs21 } from "react/jsx-runtime";
var EMPTY_TOOL_DETAILS_PANE = Object.freeze({
  open: false,
  cards: [],
  selectedIndex: 0,
  detail: false,
  diagnostics: false,
  cursor: { line: 0, offset: 0 },
  page: 0
});
function ToolDetailsPane({ state, columns, maxRows, pageRows, locale }) {
  const capacity = Math.max(1, maxRows - 3);
  const selected = state.cards[state.selectedIndex];
  const lines = [];
  let heading = `/tools \xB7 ${state.cards.length === 0 ? "0" : state.selectedIndex + 1}/${state.cards.length}`;
  if (state.detail && selected !== void 0) {
    const row = toolHeadingRow(selected, Math.max(1, columns - displayWidth(heading) - 3), true, locale);
    heading += ` \xB7 ${paintLineFromRenderLine(row, false)}`;
  }
  if (selected === void 0) lines.push(tuiCopy("noTools", locale));
  else if (!state.detail) {
    const first = Math.max(0, Math.min(state.selectedIndex - Math.floor(capacity / 2), state.cards.length - capacity));
    for (let index = first; index < Math.min(state.cards.length, first + capacity); index += 1) {
      const prefix = index === state.selectedIndex ? "> " : "  ";
      const card = state.cards[index];
      const row = toolHeadingRow(card, Math.max(1, columns - displayWidth(prefix)), false, locale);
      lines.push(`${prefix}${paintLineFromRenderLine(row, false)}`);
    }
  } else {
    const document = createToolBodyDocument(selected, { locale, diagnostics: state.diagnostics, includeArguments: true });
    const page = planToolBodyWindow(document, state.cursor, Math.max(1, columns - 2), Math.min(capacity, pageRows));
    for (const [index, fragment] of page.fragments.entries()) {
      const row = toolBodyRenderRow(materializeToolBodyRow(document, fragment), index, columns);
      lines.push(paintLineFromRenderLine(row, false));
    }
    lines.push(truncateDisplay(`${state.page + 1} \xB7 ${page.remainingLines} ${tuiCopy("remaining", locale)} \xB7 d ${tuiCopy("diagnostics", locale)} ${tuiCopy(state.diagnostics ? "on" : "off", locale)}`, columns));
  }
  return /* @__PURE__ */ jsxs21(Box23, { flexDirection: "column", width: "100%", children: [
    /* @__PURE__ */ jsx29(Text29, { wrap: "truncate", children: heading }),
    lines.map((line5, index) => /* @__PURE__ */ jsx29(Text29, { wrap: "truncate", children: line5 }, index)),
    /* @__PURE__ */ jsx29(Text29, { dimColor: true, wrap: "truncate", children: escapeContent(tuiCopy(state.detail ? "toolPageHint" : "toolListHint", locale)) })
  ] });
}

// tui-render/src/queue-chip.tsx
import { Text as Text30 } from "ink";
import { jsx as jsx30 } from "react/jsx-runtime";
function queueChipText(count) {
  return count <= 0 ? void 0 : `\u5F85\u53D1 ${String(count)} \xB7 \u2191 \u53D6\u51FA`;
}
function QueueChip({ count }) {
  const text = queueChipText(count);
  return text === void 0 ? null : /* @__PURE__ */ jsx30(Text30, { children: paintRow([styled(escapeContent(text), "fg")]) });
}

// tui-render/src/loop.tsx
var CHORD_WINDOW_MS = 600;
function activeMentionQuery(text) {
  if (!text.startsWith("@")) return void 0;
  const query = text.slice(1);
  if (query === "") return "";
  return /\s/u.test(query) ? void 0 : query;
}
function hasControlCodepoint(value) {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
function isTextInput(key, keyInfo) {
  return key.length > 0 && !keyInfo.ctrl && !keyInfo.meta && !key.startsWith("[") && !hasControlCodepoint(key);
}
function holdComposer(state, action) {
  return {
    kind: "dispatch",
    action,
    text: state.text,
    commandQuery: state.commandQuery,
    prefixG: false,
    renaming: state.renaming,
    mentionSelectedIndex: state.mentionSelectedIndex,
    mentionDismissed: state.mentionDismissed,
    commandSelectedIndex: state.commandSelectedIndex,
    commandDismissed: state.commandDismissed,
    caretIndex: state.caretIndex,
    historyIndex: state.historyIndex,
    historyDraft: state.historyDraft
  };
}
function resetComposerDispatch(state, action, text = "") {
  return {
    kind: "dispatch",
    action,
    text,
    commandQuery: state.commandQuery,
    prefixG: false,
    renaming: state.renaming
  };
}
function restoreHistoryDraft(state) {
  const restored = state.historyDraft ?? "";
  return {
    kind: "dispatch",
    action: { kind: "none" },
    text: restored,
    commandQuery: void 0,
    prefixG: false,
    renaming: state.renaming,
    caretIndex: restored.length,
    historyIndex: void 0,
    historyDraft: void 0
  };
}
function applySelectedMention(state, candidate) {
  if (candidate === void 0) return { kind: "none" };
  const inserted = normalizeMentionInsertion(candidate);
  return {
    kind: "dispatch",
    action: { kind: "none" },
    text: inserted,
    commandQuery: void 0,
    prefixG: false,
    renaming: state.renaming,
    mentionSelectedIndex: 0,
    mentionDismissed: false,
    commandSelectedIndex: 0,
    commandDismissed: false,
    caretIndex: inserted.length
  };
}
function verticalNavEffect(key, keyInfo, state, actionForDelta) {
  if (key === "j" || keyInfo.downArrow) {
    return holdComposer(state, actionForDelta(1));
  }
  if (key === "k" || keyInfo.upArrow) {
    return holdComposer(state, actionForDelta(-1));
  }
  return void 0;
}
function appendQueryFilterEffect(state, char, makeAction) {
  const appended = state.text + char;
  return {
    kind: "dispatch",
    action: makeAction(appended),
    text: appended,
    commandQuery: state.commandQuery,
    prefixG: false,
    renaming: state.renaming
  };
}
function moveCaretToEffect(state, caretIndex) {
  return {
    kind: "dispatch",
    action: { kind: "none" },
    text: state.text,
    commandQuery: state.commandQuery,
    prefixG: false,
    renaming: state.renaming,
    caretIndex,
    historyIndex: state.historyIndex,
    historyDraft: state.historyDraft
  };
}
function draftKeyEffect(state, key, keyInfo, actions) {
  if (keyInfo.escape) {
    return {
      kind: "dispatch",
      action: actions.cancel,
      text: "",
      commandQuery: void 0,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (keyInfo.return) {
    return {
      kind: "dispatch",
      action: actions.apply(state.text),
      text: "",
      commandQuery: void 0,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (keyInfo.backspace) {
    const caret = clampCaretIndex(state.text, state.caretIndex);
    const previous = moveCaretByGrapheme(state.text, caret, -1);
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: state.text.slice(0, previous) + state.text.slice(caret),
      commandQuery: void 0,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: previous
    };
  }
  if (keyInfo.leftArrow || keyInfo.rightArrow) {
    const caret = clampCaretIndex(state.text, state.caretIndex);
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: state.text,
      commandQuery: void 0,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: moveCaretByGrapheme(state.text, caret, keyInfo.leftArrow ? -1 : 1)
    };
  }
  if (isTextInput(key, keyInfo)) {
    const caret = clampCaretIndex(state.text, state.caretIndex);
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: state.text.slice(0, caret) + key + state.text.slice(caret),
      commandQuery: void 0,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: caret + key.length
    };
  }
  return { kind: "none" };
}
function overlayChordAction(key) {
  switch (key) {
    case "a":
      return { kind: "agent-hub" };
    case "t":
      return { kind: "workspace-pane" };
    case "f":
      return { kind: "feedback-pane" };
    case "w":
      return { kind: "workflow-overlay" };
    default:
      return void 0;
  }
}
function isArmedOverlayChord(state, key) {
  return state.prefixG && state.text === "g" && overlayChordAction(key) !== void 0;
}
function mapKeyEvent(state, key, keyInfo, commands, pane, search, timeline = { open: false }, modelPane = {
  open: false,
  selectedId: void 0
}, helpPane = { open: false }, approval = { open: false }, askUser = { open: false }, permission = { open: false }, settings = {
  open: false
}, submitOnEnter = true, overlays = {}, mention = {
  open: false,
  candidateCount: 0,
  selectedIndex: 0,
  selectedCandidate: void 0
}, queuedDraft = {}, compaction = { available: false }, inputHistory = []) {
  const commandMode = (state.commandQuery !== void 0 || state.text.startsWith("/")) && state.commandDismissed !== true;
  const mentionMode = activeMentionQuery(state.text) !== void 0;
  const agentHubOpen = overlays.agentHub?.open === true;
  const planDirectoryOpen = overlays.planDirectory?.open === true;
  const workspaceOpen = overlays.workspace?.open === true;
  const feedbackOpen = overlays.feedback?.open === true;
  const workflowOverlayOpen = overlays.workflowOverlay?.open === true;
  const planReviewOpen = overlays.planReview?.open === true;
  const overlayBrowseOpen = agentHubOpen || planDirectoryOpen || workspaceOpen || feedbackOpen || workflowOverlayOpen;
  const dialogOpen = approval.open || askUser.open || planReviewOpen;
  if (keyActionFor(key, keyInfo) === "copy-message") {
    return holdComposer(state, { kind: "copy-message" });
  }
  if (keyActionFor(key, keyInfo) === "intake-clipboard-image") {
    return holdComposer(state, { kind: "intake-clipboard-image" });
  }
  if (keyActionFor(key, keyInfo) === "edit-external") {
    return holdComposer(state, { kind: "edit-external", text: state.text });
  }
  if (keyActionFor(key, keyInfo) === "toggle-compaction-divider" && compaction.available) {
    return holdComposer(state, { kind: "toggle-compaction-divider" });
  }
  if (keyInfo.ctrl && key === "c") {
    return {
      kind: "dispatch",
      action: { kind: "sigint" },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (keyInfo.ctrl && key === "o") {
    return {
      kind: "dispatch",
      action: { kind: "toggle-reasoning" },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (keyInfo.ctrl && key === "e") {
    return {
      kind: "dispatch",
      action: { kind: "toggle-tool-cards" },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (keyInfo.ctrl && key === "n") {
    return {
      kind: "dispatch",
      action: { kind: "new-session" },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: false
    };
  }
  if (keyInfo.ctrl && key === "k") {
    if (dialogOpen) return { kind: "none" };
    return {
      kind: "dispatch",
      action: { kind: "search-pane" },
      text: "",
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (keyInfo.ctrl && key === "t") {
    if (dialogOpen) return { kind: "none" };
    return {
      kind: "dispatch",
      action: { kind: "toggle-timeline" },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (approval.open) {
    if (isArmedOverlayChord(state, key)) {
      return { kind: "none" };
    }
    if (key === "y" || key === "a") {
      return holdComposer(state, { kind: "approval-allow" });
    }
    if (key === "n" || key === "d" || keyInfo.escape) {
      return holdComposer(state, { kind: "approval-deny" });
    }
    if (key === "i") {
      return holdComposer(state, { kind: "approval-detail" });
    }
    return { kind: "none" };
  }
  if (askUser.open) {
    if (keyInfo.escape) {
      return holdComposer(state, { kind: "ask-user-cancel" });
    }
    if (keyInfo.return) {
      if ((askUser.optionCount ?? 0) === 0) return { kind: "none" };
      return holdComposer(state, { kind: "ask-user-submit" });
    }
    if (key >= "1" && key <= "9") {
      const index = Number(key) - 1;
      if (index >= (askUser.optionCount ?? 0)) return { kind: "none" };
      return holdComposer(state, { kind: "ask-user-digit", index });
    }
    if ((askUser.optionCount ?? 0) > 0 && !keyInfo.ctrl) {
      if (key === "j" || keyInfo.downArrow) {
        return holdComposer(state, { kind: "ask-user-move", delta: 1 });
      }
      if (key === "k" || keyInfo.upArrow) {
        return holdComposer(state, { kind: "ask-user-move", delta: -1 });
      }
    }
    return { kind: "none" };
  }
  if (planReviewOpen) {
    if (isArmedOverlayChord(state, key)) {
      return { kind: "none" };
    }
    if (key === "y") {
      return holdComposer(state, { kind: "plan-review-approve" });
    }
    if (key === "n") {
      return holdComposer(state, { kind: "plan-review-keep" });
    }
    if (keyInfo.escape) {
      return holdComposer(state, { kind: "ask-user-cancel" });
    }
    if (key === "j" || keyInfo.downArrow) {
      return holdComposer(state, { kind: "plan-review-scroll", delta: 1 });
    }
    if (key === "k" || keyInfo.upArrow) {
      return holdComposer(state, { kind: "plan-review-scroll", delta: -1 });
    }
    return { kind: "none" };
  }
  if (permission.open) {
    if (keyInfo.escape) {
      return holdComposer(state, { kind: "permission-escape" });
    }
    if (keyInfo.return) {
      return holdComposer(state, { kind: "permission-apply" });
    }
    if (key === "j" || keyInfo.downArrow) {
      return holdComposer(state, { kind: "permission-move", delta: 1 });
    }
    if (key === "k" || keyInfo.upArrow) {
      return holdComposer(state, { kind: "permission-move", delta: -1 });
    }
    if (key === "1" || key === "2" || key === "3") {
      return holdComposer(state, {
        kind: "permission-jump",
        index: Number(key) - 1
      });
    }
    return { kind: "none" };
  }
  if (settings.open && (settings.editing === true || settings.onboarding === true)) {
    return draftKeyEffect(state, key, keyInfo, {
      cancel: settings.onboarding === true ? { kind: "settings-escape" } : { kind: "settings-cancel-edit" },
      apply: (text) => ({ kind: "settings-apply", value: text })
    });
  }
  if (workspaceOpen && overlays.workspace?.editing === true) {
    return draftKeyEffect(state, key, keyInfo, {
      cancel: { kind: "workspace-cancel-edit" },
      apply: (text) => ({ kind: "workspace-apply", value: text })
    });
  }
  if (feedbackOpen && overlays.feedback?.editing === true) {
    return draftKeyEffect(state, key, keyInfo, {
      cancel: { kind: "feedback-note-cancel" },
      apply: (text) => ({ kind: "feedback-note-apply", value: text })
    });
  }
  if (settings.open) {
    if (keyInfo.escape) {
      return holdComposer(state, { kind: "settings-escape" });
    }
    if (keyInfo.return) {
      return {
        kind: "dispatch",
        action: { kind: "settings-edit" },
        text: settings.editValue ?? "",
        commandQuery: void 0,
        prefixG: false,
        renaming: state.renaming
      };
    }
    if (key === "j" || keyInfo.downArrow) {
      return holdComposer(state, { kind: "settings-move", delta: 1 });
    }
    if (key === "k" || keyInfo.upArrow) {
      return holdComposer(state, { kind: "settings-move", delta: -1 });
    }
    if (key === "e") {
      return holdComposer(state, { kind: "settings-export" });
    }
    if (key === "r") {
      return holdComposer(state, { kind: "settings-reload" });
    }
    return { kind: "none" };
  }
  if (keyInfo.escape) {
    if (commandMode) {
      return {
        kind: "dispatch",
        action: { kind: "none" },
        text: state.text,
        commandQuery: void 0,
        prefixG: false,
        renaming: state.renaming,
        commandSelectedIndex: 0,
        commandDismissed: true,
        caretIndex: state.caretIndex
      };
    }
    if (mention.open) {
      return {
        kind: "dispatch",
        action: { kind: "none" },
        text: state.text,
        commandQuery: void 0,
        prefixG: false,
        renaming: state.renaming,
        mentionDismissed: true
      };
    }
    if (agentHubOpen) {
      return holdComposer(state, { kind: "agent-hub-escape" });
    }
    if (planDirectoryOpen) {
      return holdComposer(state, { kind: "plan-directory-escape" });
    }
    if (workspaceOpen) {
      return holdComposer(state, { kind: "workspace-escape" });
    }
    if (feedbackOpen) {
      return holdComposer(state, { kind: "feedback-escape" });
    }
    if (workflowOverlayOpen) {
      return holdComposer(state, { kind: "workflow-overlay-escape" });
    }
    if (modelPane.open) {
      return resetComposerDispatch(state, { kind: "model-pane" });
    }
    if (helpPane.open) {
      return holdComposer(state, { kind: "help-pane" });
    }
    if (search.open) {
      return resetComposerDispatch(state, { kind: "search-pane" });
    }
    if (state.renaming) {
      return {
        kind: "dispatch",
        action: { kind: "none" },
        text: "",
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: false
      };
    }
    if (pane.open) {
      return {
        kind: "dispatch",
        action: { kind: "session-pane" },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: false
      };
    }
    if (timeline.open) {
      return {
        kind: "dispatch",
        action: { kind: "toggle-timeline" },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming
      };
    }
    if (state.historyIndex !== void 0) {
      return restoreHistoryDraft(state);
    }
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: state.text,
      commandQuery: void 0,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (keyInfo.return) {
    if (mention.open) {
      return applySelectedMention(state, mention.selectedCandidate);
    }
    if (agentHubOpen) {
      return holdComposer(state, { kind: "agent-hub-enter" });
    }
    if (planDirectoryOpen) {
      return holdComposer(state, { kind: "plan-directory-apply" });
    }
    if (workspaceOpen) {
      if (overlays.workspace?.selectedKind === "file") {
        const caret = clampCaretIndex(state.text, state.caretIndex);
        const path = overlays.workspace.selectedPath ?? "";
        return {
          kind: "dispatch",
          action: { kind: "workspace-enter" },
          text: state.text.slice(0, caret) + path + state.text.slice(caret),
          commandQuery: void 0,
          prefixG: false,
          renaming: state.renaming,
          caretIndex: caret + path.length
        };
      }
      return holdComposer(state, { kind: "workspace-enter" });
    }
    if (modelPane.open) {
      if (modelPane.selectedId === void 0) return { kind: "none" };
      return resetComposerDispatch(state, {
        kind: "select-model",
        id: modelPane.selectedId
      });
    }
    if (helpPane.open) {
      return holdComposer(state, { kind: "help-pane" });
    }
    if (search.open) {
      if (search.selectedId === void 0) return { kind: "none" };
      return resetComposerDispatch(state, {
        kind: "select-session",
        id: search.selectedId
      });
    }
    if (state.renaming) {
      return {
        kind: "dispatch",
        action: { kind: "rename-session", title: state.text },
        text: "",
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: false
      };
    }
    if (pane.open) {
      if (pane.selectedId === void 0) return { kind: "none" };
      return {
        kind: "dispatch",
        action: { kind: "select-session", id: pane.selectedId },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: false
      };
    }
    if (keyInfo.shift || !submitOnEnter && !keyInfo.ctrl && !commandMode) {
      return {
        kind: "dispatch",
        action: { kind: "none" },
        text: `${state.text}
`,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming
      };
    }
    if (commandMode) {
      const query = resolveEnterQuery(
        commands,
        state.commandQuery ?? state.text.slice(1),
        state.commandSelectedIndex ?? 0
      );
      return {
        kind: "dispatch",
        action: { kind: "command", query },
        text: "",
        commandQuery: void 0,
        prefixG: false,
        renaming: state.renaming,
        commandSelectedIndex: 0,
        commandDismissed: false
      };
    }
    return {
      kind: "dispatch",
      action: { kind: "send", text: state.text },
      text: "",
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (keyInfo.backspace) {
    if (modelPane.open) {
      const shortened2 = state.text.slice(0, -1);
      return {
        kind: "dispatch",
        action: { kind: "model-filter", query: shortened2 },
        text: shortened2,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming
      };
    }
    if (helpPane.open) {
      return { kind: "none" };
    }
    if (search.open) {
      const shortened2 = state.text.slice(0, -1);
      return {
        kind: "dispatch",
        action: { kind: "search", query: shortened2 },
        text: shortened2,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming
      };
    }
    const caret = clampCaretIndex(state.text, state.caretIndex);
    const previous = moveCaretByGrapheme(state.text, caret, -1);
    const shortened = state.text.slice(0, previous) + state.text.slice(caret);
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: shortened,
      commandQuery: shortened.startsWith("/") ? shortened.slice(1) : void 0,
      prefixG: false,
      renaming: state.renaming,
      mentionSelectedIndex: 0,
      mentionDismissed: false,
      commandSelectedIndex: 0,
      commandDismissed: false,
      caretIndex: previous,
      historyIndex: state.historyIndex,
      historyDraft: state.historyDraft
    };
  }
  if ((key === "	" || keyInfo.tab) && keyInfo.shift) {
    if (dialogOpen) return { kind: "none" };
    return {
      kind: "dispatch",
      action: { kind: "cycle-mode" },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (key === "	" || keyInfo.tab) {
    if (mention.open) {
      return applySelectedMention(state, mention.selectedCandidate);
    }
    if (commandMode) {
      const query = state.commandQuery ?? state.text.slice(1);
      const completed = completeSelected(commands, query, state.commandSelectedIndex ?? 0);
      if (completed !== void 0) {
        return {
          kind: "dispatch",
          action: { kind: "none" },
          text: `/${completed.name}`,
          commandQuery: completed.name,
          prefixG: false,
          renaming: state.renaming,
          commandSelectedIndex: 0,
          commandDismissed: false,
          caretIndex: completed.name.length + 1
        };
      }
    }
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (commandMode && (key === "j" || keyInfo.downArrow || key === "k" || keyInfo.upArrow)) {
    const query = state.commandQuery ?? state.text.slice(1);
    const count = filterCommands(commands, query).length;
    const delta = key === "j" || keyInfo.downArrow ? 1 : -1;
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: state.text,
      commandQuery: state.commandQuery ?? query,
      prefixG: false,
      renaming: state.renaming,
      commandSelectedIndex: moveSelectionIndex(state.commandSelectedIndex ?? 0, delta, count),
      commandDismissed: false,
      caretIndex: state.caretIndex
    };
  }
  if (state.renaming) {
    if (!isTextInput(key, keyInfo)) {
      return { kind: "none" };
    }
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: state.text + key,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (mention.open) {
    if (key === "j" || keyInfo.downArrow) {
      return {
        kind: "dispatch",
        action: { kind: "none" },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        mentionSelectedIndex: moveSelectionIndex(mention.selectedIndex, 1, mention.candidateCount),
        mentionDismissed: false,
        caretIndex: state.caretIndex
      };
    }
    if (key === "k" || keyInfo.upArrow) {
      return {
        kind: "dispatch",
        action: { kind: "none" },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        mentionSelectedIndex: moveSelectionIndex(mention.selectedIndex, -1, mention.candidateCount),
        mentionDismissed: false,
        caretIndex: state.caretIndex
      };
    }
  }
  if (search.open) {
    const nav = verticalNavEffect(key, keyInfo, state, (delta) => ({ kind: "session-pane-move", delta }));
    if (nav !== void 0) return nav;
    if (isTextInput(key, keyInfo)) {
      return appendQueryFilterEffect(state, key, (query) => ({ kind: "search", query }));
    }
    return { kind: "none" };
  }
  if (timeline.open) {
    const nav = verticalNavEffect(key, keyInfo, state, (delta) => ({ kind: "timeline-scroll", delta }));
    if (nav !== void 0) return nav;
    return { kind: "none" };
  }
  if (modelPane.open) {
    const nav = verticalNavEffect(key, keyInfo, state, (delta) => ({ kind: "model-move", delta }));
    if (nav !== void 0) return nav;
    if (isTextInput(key, keyInfo)) {
      return appendQueryFilterEffect(state, key, (query) => ({ kind: "model-filter", query }));
    }
    return { kind: "none" };
  }
  if (helpPane.open) {
    const nav = verticalNavEffect(key, keyInfo, state, (delta) => ({ kind: "help-scroll", delta }));
    if (nav !== void 0) return nav;
    return { kind: "none" };
  }
  if (key === "g" && state.text === "") {
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: "g",
      commandQuery: state.commandQuery,
      prefixG: true,
      renaming: state.renaming,
      caretIndex: 1
    };
  }
  if (key === "s" && state.prefixG && state.text === "g") {
    return {
      kind: "dispatch",
      action: { kind: "session-pane" },
      text: "",
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  const overlayAction = overlayChordAction(key);
  if (overlayAction !== void 0 && state.prefixG && state.text === "g") {
    return {
      kind: "dispatch",
      action: overlayAction,
      text: "",
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (agentHubOpen) {
    if (key === "j" || keyInfo.downArrow) {
      return holdComposer(state, { kind: "agent-hub-move", delta: 1 });
    }
    if (key === "k" || keyInfo.upArrow) {
      return holdComposer(state, { kind: "agent-hub-move", delta: -1 });
    }
  }
  if (planDirectoryOpen) {
    if (key === "j" || keyInfo.downArrow) {
      return holdComposer(state, { kind: "plan-directory-move", delta: 1 });
    }
    if (key === "k" || keyInfo.upArrow) {
      return holdComposer(state, { kind: "plan-directory-move", delta: -1 });
    }
  }
  if (workflowOverlayOpen) {
    if (key === "j" || keyInfo.downArrow) {
      return holdComposer(state, { kind: "workflow-overlay-scroll", delta: 1 });
    }
    if (key === "k" || keyInfo.upArrow) {
      return holdComposer(state, { kind: "workflow-overlay-scroll", delta: -1 });
    }
  }
  if (workspaceOpen) {
    if (key === "j" || keyInfo.downArrow) {
      return holdComposer(state, { kind: "workspace-move", delta: 1 });
    }
    if (key === "k" || keyInfo.upArrow) {
      return holdComposer(state, { kind: "workspace-move", delta: -1 });
    }
    if (key === "e") {
      const draft = overlays.workspace?.rootPath ?? "";
      return {
        kind: "dispatch",
        action: { kind: "workspace-edit" },
        text: draft,
        commandQuery: void 0,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: draft.length
      };
    }
  }
  if (feedbackOpen) {
    if (key === "l") {
      return holdComposer(state, { kind: "feedback-rate", rating: "positive" });
    }
    if (key === "d") {
      return holdComposer(state, { kind: "feedback-rate", rating: "negative" });
    }
    if (key === "e") {
      const draft = overlays.feedback?.note ?? "";
      return {
        kind: "dispatch",
        action: { kind: "feedback-note-edit" },
        text: draft,
        commandQuery: void 0,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: draft.length
      };
    }
  }
  if (overlayBrowseOpen) {
    return { kind: "none" };
  }
  if (pane.open) {
    const nav = verticalNavEffect(key, keyInfo, state, (delta) => ({ kind: "session-pane-move", delta }));
    if (nav !== void 0) return nav;
    if (key === "r") {
      return {
        kind: "dispatch",
        action: { kind: "none" },
        text: "",
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: true
      };
    }
    if (key === "d") {
      return {
        kind: "dispatch",
        action: { kind: "delete-session" },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming
      };
    }
    return {
      kind: "dispatch",
      action: { kind: "session-pane-idle" },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming
    };
  }
  if (keyInfo.leftArrow || keyInfo.rightArrow) {
    const caret = clampCaretIndex(state.text, state.caretIndex);
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: moveCaretByGrapheme(
        state.text,
        caret,
        keyInfo.leftArrow ? -1 : 1
      ),
      historyIndex: state.historyIndex,
      historyDraft: state.historyDraft
    };
  }
  if (keyInfo.pageUp) {
    return holdComposer(state, { kind: "scroll-page", delta: 1 });
  }
  if (keyInfo.pageDown) {
    return holdComposer(state, { kind: "scroll-page", delta: -1 });
  }
  if (keyInfo.home) {
    return holdComposer(state, { kind: "scroll-edge", edge: "oldest" });
  }
  if (keyInfo.end) {
    return holdComposer(state, { kind: "scroll-edge", edge: "latest" });
  }
  if (keyInfo.upArrow) {
    if (state.text.includes("\n")) {
      const caret = clampCaretIndex(state.text, state.caretIndex);
      const targetCaret = moveCaretUpLine(state.text, caret);
      if (targetCaret !== void 0) {
        return moveCaretToEffect(state, targetCaret);
      }
    }
    if (state.text === "" && queuedDraft.headText !== void 0) {
      return {
        kind: "dispatch",
        action: { kind: "take-queued-draft" },
        text: queuedDraft.headText,
        commandQuery: void 0,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: queuedDraft.headText.length,
        historyIndex: void 0,
        historyDraft: void 0
      };
    }
    if (inputHistory.length > 0) {
      const isBrowsing = state.historyIndex !== void 0;
      const currentIndex = state.historyIndex ?? inputHistory.length;
      const nextIndex = Math.max(0, currentIndex - 1);
      const nextText = inputHistory[nextIndex] ?? "";
      const savedDraft = isBrowsing ? state.historyDraft : state.text;
      return {
        kind: "dispatch",
        action: { kind: "none" },
        text: nextText,
        commandQuery: void 0,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: nextText.length,
        historyIndex: nextIndex,
        historyDraft: savedDraft
      };
    }
    return { kind: "none" };
  }
  if (keyInfo.downArrow) {
    if (state.text.includes("\n")) {
      const caret = clampCaretIndex(state.text, state.caretIndex);
      const targetCaret = moveCaretDownLine(state.text, caret);
      if (targetCaret !== void 0) {
        return moveCaretToEffect(state, targetCaret);
      }
    }
    if (state.historyIndex !== void 0) {
      const nextIndex = state.historyIndex + 1;
      if (nextIndex < inputHistory.length) {
        const nextText = inputHistory[nextIndex] ?? "";
        return {
          kind: "dispatch",
          action: { kind: "none" },
          text: nextText,
          commandQuery: void 0,
          prefixG: false,
          renaming: state.renaming,
          caretIndex: nextText.length,
          historyIndex: nextIndex,
          historyDraft: state.historyDraft
        };
      }
      return restoreHistoryDraft(state);
    }
    return { kind: "none" };
  }
  if (/^[jk]+$/u.test(key) && !keyInfo.ctrl && !keyInfo.meta && state.text === "") {
    let delta = 0;
    for (const char of key) {
      if (char === "k") delta += 1;
      else if (char === "j") delta -= 1;
    }
    return {
      kind: "dispatch",
      action: { kind: "scroll", delta },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: state.caretIndex
    };
  }
  if (key === "G" && state.text === "") {
    return holdComposer(state, { kind: "scroll-edge", edge: "latest" });
  }
  if (key === "/") {
    const caret = clampCaretIndex(state.text, state.caretIndex);
    const text = `${state.text.slice(0, caret)}/${state.text.slice(caret)}`;
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text,
      commandQuery: text.startsWith("/") ? text.slice(1) : state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: caret + 1,
      commandSelectedIndex: 0,
      commandDismissed: false,
      historyIndex: state.historyIndex,
      historyDraft: state.historyDraft
    };
  }
  if (key === "@") {
    const caret = clampCaretIndex(state.text, state.caretIndex);
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: `${state.text.slice(0, caret)}@${state.text.slice(caret)}`,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      mentionSelectedIndex: 0,
      mentionDismissed: false,
      commandSelectedIndex: 0,
      commandDismissed: false,
      caretIndex: caret + 1,
      historyIndex: state.historyIndex,
      historyDraft: state.historyDraft
    };
  }
  if (isTextInput(key, keyInfo)) {
    const caret = clampCaretIndex(state.text, state.caretIndex);
    const appended = state.text.slice(0, caret) + key + state.text.slice(caret);
    return {
      kind: "dispatch",
      action: { kind: "none" },
      text: appended,
      commandQuery: appended.startsWith("/") ? appended.slice(1) : state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      mentionSelectedIndex: 0,
      mentionDismissed: false,
      commandSelectedIndex: 0,
      commandDismissed: false,
      caretIndex: caret + key.length,
      historyIndex: state.historyIndex,
      historyDraft: state.historyDraft
    };
  }
  void mentionMode;
  return {
    kind: "dispatch",
    action: { kind: "none" },
    text: state.text,
    commandQuery: state.commandQuery,
    prefixG: false,
    renaming: state.renaming,
    historyIndex: state.historyIndex,
    historyDraft: state.historyDraft
  };
}
function feedbackLabel(feedback) {
  return feedback === void 0 ? void 0 : escapeContent(feedback);
}
function isSessionTransitionStatus(value) {
  return value !== void 0 && value.startsWith("\u6B63\u5728") && value.endsWith("\u4F1A\u8BDD\u2026");
}
function isSessionTransitionAction(action) {
  return action.kind === "new-session" || action.kind === "select-session";
}
var STATUS_HINT = "j/k \u6EDA\u52A8";
function statusHintText(interaction, occupied = false) {
  if (occupied) return "";
  if (interaction !== "generating" && interaction !== "stopped") return "";
  return STATUS_HINT;
}
function shortenHomePath(cwd, home) {
  if (cwd === home) return "~";
  if (home !== "" && cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}
function feedbackLine(feedback, style = "auto") {
  const label = feedbackLabel(feedback);
  if (label === void 0) return void 0;
  if (style === "neutral") return styled(label, "fg");
  if (isSessionTransitionStatus(feedback)) return styled(label, "accent");
  return styled(label, label.startsWith("\u2713") ? "success" : "error");
}
function statusText(interaction) {
  switch (interaction) {
    case "generating":
      return "\u23F9 Ctrl+C \u505C\u6B62";
    case "stopped":
      return "\u7EE7\u7EED\u751F\u6210";
    case "exit-armed":
      return "\u518D\u6309\u4E00\u6B21 Ctrl+C \u9000\u51FA";
    case "idle":
      return "";
  }
}
function TuiLoop({
  title,
  controller,
  brandTier = "plain",
  brandAutoEligible = false,
  brandFrameProbe,
  frameProbe,
  renderPolicy,
  frameMetrics
}) {
  const [state, setState] = useState3({
    text: controller.getComposerDraft?.() ?? "",
    commandQuery: void 0,
    commandSelectedIndex: 0,
    commandDismissed: false,
    prefixG: false,
    renaming: false,
    mentionSelectedIndex: 0,
    mentionDismissed: false
  });
  const [mentionPhase, setMentionPhase] = useState3("ready");
  const [mentionCandidates, setMentionCandidates] = useState3([]);
  const [timelineOffset, setTimelineOffset] = useState3(0);
  const [helpOffset, setHelpOffset] = useState3(0);
  const [planReviewOffset, setPlanReviewOffset] = useState3(0);
  const viewportSequenceRef = useRef4(0);
  const [viewportCommand, setViewportCommand] = useState3();
  const issueViewportCommand = useCallback2((command) => {
    frameProbe?.beginMeasurement();
    viewportSequenceRef.current += 1;
    setViewportCommand({ ...command, sequence: viewportSequenceRef.current });
  }, [frameProbe]);
  const brandRevealStartedRef = useRef4(false);
  const brandRevealStoppedRef = useRef4(false);
  const stateRef = useRef4(state);
  const mentionSeqRef = useRef4(0);
  const mentionAbortRef = useRef4(void 0);
  stateRef.current = state;
  const model = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getModel()
  );
  useEffect3(() => {
    if (model.status === "generating") frameProbe?.beginMeasurement();
  }, [frameProbe, model.status]);
  const [, setGeneratingTick] = useState3(0);
  useEffect3(() => {
    if (model.status !== "generating") return;
    const timer = setInterval(() => {
      setGeneratingTick((t) => (t + 1) % 1e4);
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, [model.status]);
  const footerSpinner = model.status === "generating" ? getBrailleSpinnerFrame(Date.now()) : void 0;
  const interaction = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getInteraction()
  );
  const badge = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getBadge()
  );
  const liveTitle = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getTitle()
  );
  const pane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getSessionPane()
  );
  const search = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getSearchPane()
  );
  const timelineOpen = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getTimelineOpen()
  );
  const modelPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getModelPane()
  );
  const helpPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getHelpPane()
  );
  const toolDetailsPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getToolDetailsPane?.() ?? EMPTY_TOOL_DETAILS_PANE
  );
  const approvalPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getApprovalPane()
  );
  const askUserPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getAskUserPane()
  );
  const permissionPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getPermissionPane()
  );
  const settingsPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getSettingsPane()
  );
  const agentHubPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getAgentHubPane()
  );
  const planDirectoryPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getPlanDirectoryPane()
  );
  const workspacePane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getWorkspacePane()
  );
  const feedbackPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getFeedbackPane()
  );
  const workflowOverlay = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getWorkflowOverlay()
  );
  const planReviewPane = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getPlanReviewPane()
  );
  const composerHud = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getComposerHud()
  );
  const queuedDraftText = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getQueuedDraftText?.()
  );
  const queuedDraftCount = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getQueuedDraftCount?.() ?? 0
  );
  const goalFooter = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getGoalFooter?.()
  );
  const adaptiveInfoFooter = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getAdaptiveInfoFooter?.()
  );
  const todoHud = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getTodoHud?.()
  );
  const jobsHud = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getJobsHud?.()
  );
  const workflowHud = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getWorkflowHud?.()
  );
  const sessionStats = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getSessionStats?.()
  );
  const brandAnimationMode = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getBrandAnimation?.() ?? "off"
  );
  const controllerMode = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getMode?.()
  );
  const scrollbar = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getScrollbarVisible?.() ?? true
  );
  const statusDetails = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getStatusDetails?.() ?? false
  );
  const locale = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getLocale?.() ?? "zh-CN"
  );
  const [localMode, setLocalMode] = useState3("agent");
  const currentMode = controllerMode ?? localMode;
  const { columns, rows } = useWindowSize9();
  useEffect3(() => {
    if (helpPane.open) setHelpOffset(0);
  }, [helpPane.open]);
  useEffect3(() => {
    if (planReviewPane.open) setPlanReviewOffset(0);
  }, [planReviewPane.open]);
  const feedback = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getFeedback()
  );
  const feedbackRef = useRef4(feedback);
  feedbackRef.current = feedback;
  const paneRef = useRef4(pane);
  paneRef.current = pane;
  const searchRef = useRef4(search);
  searchRef.current = search;
  const timelineOpenRef = useRef4(timelineOpen);
  timelineOpenRef.current = timelineOpen;
  const modelPaneRef = useRef4(modelPane);
  modelPaneRef.current = modelPane;
  const helpPaneRef = useRef4(helpPane);
  helpPaneRef.current = helpPane;
  const toolDetailsPaneRef = useRef4(toolDetailsPane);
  toolDetailsPaneRef.current = toolDetailsPane;
  const toolDetailsSizeRef = useRef4({ width: columns, pageRows: 1 });
  const approvalPaneRef = useRef4(approvalPane);
  approvalPaneRef.current = approvalPane;
  const askUserPaneRef = useRef4(askUserPane);
  askUserPaneRef.current = askUserPane;
  const permissionPaneRef = useRef4(permissionPane);
  permissionPaneRef.current = permissionPane;
  const settingsPaneRef = useRef4(settingsPane);
  settingsPaneRef.current = settingsPane;
  const agentHubPaneRef = useRef4(agentHubPane);
  agentHubPaneRef.current = agentHubPane;
  const planDirectoryPaneRef = useRef4(planDirectoryPane);
  planDirectoryPaneRef.current = planDirectoryPane;
  const workspacePaneRef = useRef4(workspacePane);
  workspacePaneRef.current = workspacePane;
  const feedbackPaneRef = useRef4(feedbackPane);
  feedbackPaneRef.current = feedbackPane;
  const workflowOverlayRef = useRef4(workflowOverlay);
  workflowOverlayRef.current = workflowOverlay;
  const planReviewPaneRef = useRef4(planReviewPane);
  planReviewPaneRef.current = planReviewPane;
  const helpLinesRef = useRef4(helpPane.lines);
  helpLinesRef.current = helpPane.lines;
  const historyLengthRef = useRef4(model.history.length);
  historyLengthRef.current = model.history.length;
  const sentHistoryRef = useRef4([]);
  const inputHistory = useMemo2(() => {
    const fromModel = model.history.filter((m) => m.kind === "user" && typeof m.text === "string" && m.text.trim().length > 0).map((m) => m.text);
    const combined = [];
    for (const item of [...fromModel, ...sentHistoryRef.current]) {
      const trimmed = item.trim();
      if (trimmed.length > 0 && combined.at(-1) !== trimmed) {
        combined.push(trimmed);
      }
    }
    return combined;
  }, [model.history]);
  const chordTimerRef = useRef4(
    void 0
  );
  const clearChord = () => {
    if (chordTimerRef.current !== void 0) {
      clearTimeout(chordTimerRef.current);
      chordTimerRef.current = void 0;
    }
  };
  useEffect3(() => clearChord, []);
  useEffect3(() => {
    const listener = (delta) => {
      frameMetrics?.recordInputEvent();
      if (toolDetailsPaneRef.current.open) {
        controller.dispatch({ kind: "tool-details", input: delta > 0 ? "up" : "down", ...toolDetailsSizeRef.current });
        return;
      }
      const settingsState = settingsPaneRef.current;
      if (settingsState.open) {
        if (settingsState.editing || settingsState.onboarding === true) return;
        controller.dispatch({ kind: "settings-move", delta: -delta });
        return;
      }
      if (helpPaneRef.current.open) {
        const maxOffset2 = Math.max(0, helpLinesRef.current.length - HELP_WINDOW);
        setHelpOffset(
          (previous) => Math.max(0, Math.min(previous - delta, maxOffset2))
        );
        return;
      }
      if (timelineOpenRef.current) {
        const maxOffset2 = Math.max(
          0,
          historyLengthRef.current - TIMELINE_WINDOW
        );
        setTimelineOffset(
          (previous) => Math.max(0, Math.min(previous - delta, maxOffset2))
        );
        return;
      }
      issueViewportCommand({ kind: "scroll", delta });
    };
    setMouseScrollListener(listener);
    setMouseRailListener((fraction) => {
      issueViewportCommand({ kind: "position", fraction });
    });
    return () => {
      setMouseScrollListener(void 0);
      setMouseRailListener(void 0);
    };
  }, [controller, frameMetrics, issueViewportCommand]);
  useInput((key, keyInfo) => {
    frameMetrics?.recordInputEvent();
    controller.noteUserActivity();
    if (toolDetailsPaneRef.current.open && !approvalPaneRef.current.open && !askUserPaneRef.current.open && !planReviewPaneRef.current.open) {
      if (keyInfo.ctrl && key === "c") controller.dispatch({ kind: "sigint" });
      else {
        const input = toolDetailsKeyAction(key, keyInfo);
        if (input !== void 0) controller.dispatch({ kind: "tool-details", input, ...toolDetailsSizeRef.current });
      }
      return;
    }
    const current = stateRef.current;
    const effect = mapKeyEvent(
      current,
      key,
      keyInfo,
      controller.commands,
      {
        open: paneRef.current.open,
        selectedId: paneRef.current.selectedIndex < paneRef.current.rows.length ? paneRef.current.rows[paneRef.current.selectedIndex]?.id : void 0
      },
      {
        open: searchRef.current.open,
        selectedId: searchRef.current.selectedIndex < searchRef.current.results.length ? searchRef.current.results[searchRef.current.selectedIndex]?.id : void 0
      },
      { open: timelineOpenRef.current },
      {
        open: modelPaneRef.current.open,
        selectedId: modelPaneRef.current.selectedIndex < modelPaneRef.current.rows.length ? modelPaneRef.current.rows[modelPaneRef.current.selectedIndex]?.id : void 0
      },
      { open: helpPaneRef.current.open },
      { open: approvalPaneRef.current.open },
      {
        open: askUserPaneRef.current.open,
        optionCount: askUserPaneRef.current.options.length
      },
      { open: permissionPaneRef.current.open },
      {
        open: settingsPaneRef.current.open,
        editing: settingsPaneRef.current.editing,
        onboarding: settingsPaneRef.current.onboarding,
        editValue: settingsPaneRef.current.rows[settingsPaneRef.current.selectedIndex]?.value
      },
      controller.getSubmitOnEnter(),
      {
        agentHub: { open: agentHubPaneRef.current.open },
        planDirectory: { open: planDirectoryPaneRef.current.open },
        workspace: {
          open: workspacePaneRef.current.open,
          editing: workspacePaneRef.current.editing,
          rootPath: workspacePaneRef.current.root,
          selectedKind: workspacePaneRef.current.nodes[workspacePaneRef.current.selectedIndex]?.kind,
          selectedPath: workspacePaneRef.current.nodes[workspacePaneRef.current.selectedIndex]?.path
        },
        feedback: {
          open: feedbackPaneRef.current.open,
          editing: feedbackPaneRef.current.editing,
          note: feedbackPaneRef.current.note
        },
        workflowOverlay: { open: workflowOverlayRef.current.open },
        planReview: { open: planReviewPaneRef.current.open }
      },
      {
        open: mentionMode,
        candidateCount: mentionCandidates.length,
        selectedIndex: current.mentionSelectedIndex,
        selectedCandidate: mentionCandidates[current.mentionSelectedIndex]
      },
      { headText: queuedDraftText },
      { available: (model.compactionDividers?.length ?? 0) > 0 },
      inputHistory
    );
    if (effect.kind === "dispatch") {
      const action = effect.action;
      if (isSessionTransitionAction(action) && isSessionTransitionStatus(feedbackRef.current)) {
      } else if (action.kind === "timeline-scroll") {
        const maxOffset2 = Math.max(
          0,
          historyLengthRef.current - TIMELINE_WINDOW
        );
        setTimelineOffset(
          (previous) => Math.max(0, Math.min(previous + action.delta, maxOffset2))
        );
      } else if (action.kind === "help-scroll") {
        const maxOffset2 = Math.max(0, helpLinesRef.current.length - HELP_WINDOW);
        setHelpOffset(
          (previous) => Math.max(0, Math.min(previous + action.delta, maxOffset2))
        );
      } else if (action.kind === "plan-review-scroll") {
        const lines = (planReviewPaneRef.current.plan ?? "").split("\n");
        const maxOffset2 = Math.max(0, lines.length - PLAN_REVIEW_WINDOW);
        setPlanReviewOffset(
          (previous) => Math.max(0, Math.min(previous + action.delta, maxOffset2))
        );
      } else if (action.kind === "scroll") {
        issueViewportCommand({ kind: "scroll", delta: action.delta });
      } else if (action.kind === "scroll-page") {
        issueViewportCommand({ kind: "page", delta: action.delta });
      } else if (action.kind === "scroll-edge") {
        issueViewportCommand({ kind: "edge", edge: action.edge });
      } else if (action.kind === "send") {
        const trimmed = action.text.trim();
        if (trimmed.length > 0 && sentHistoryRef.current.at(-1) !== trimmed) {
          sentHistoryRef.current.push(trimmed);
        }
        issueViewportCommand({ kind: "reset" });
        controller.dispatch(action);
      } else if (action.kind === "command") {
        const queryText = action.query.trim().startsWith("/") ? action.query.trim() : `/${action.query.trim()}`;
        if (queryText.length > 0 && sentHistoryRef.current.at(-1) !== queryText) {
          sentHistoryRef.current.push(queryText);
        }
        controller.dispatch(action);
      } else if (action.kind === "new-session" || action.kind === "select-session") {
        sentHistoryRef.current = [];
        issueViewportCommand({ kind: "reset" });
        controller.dispatch(action);
      } else if (action.kind === "intake-clipboard-image") {
        void controller.intakeClipboardImage().then((result) => {
          if (result.ok) insertImageToken(result.token);
          else controller.note(result.reason);
        });
      } else if (action.kind === "cycle-mode") {
        setLocalMode((prev) => prev === "agent" ? "plan" : prev === "plan" ? "focus" : "agent");
        controller.dispatch(action);
      } else if (action.kind !== "none") {
        controller.dispatch(action);
      }
      clearChord();
      if (effect.prefixG && !current.prefixG) {
        chordTimerRef.current = setTimeout(() => {
          const cleared = {
            ...stateRef.current,
            prefixG: false
          };
          stateRef.current = cleared;
          setState(cleared);
        }, CHORD_WINDOW_MS);
      }
    }
    const next = effect.kind === "dispatch" ? {
      text: effect.text,
      commandQuery: effect.commandQuery,
      prefixG: effect.prefixG,
      renaming: effect.renaming,
      mentionSelectedIndex: effect.mentionSelectedIndex ?? current.mentionSelectedIndex,
      mentionDismissed: effect.mentionDismissed ?? current.mentionDismissed,
      commandSelectedIndex: effect.commandSelectedIndex ?? current.commandSelectedIndex,
      commandDismissed: effect.commandDismissed ?? current.commandDismissed,
      caretIndex: effect.caretIndex ?? (effect.text === current.text ? current.caretIndex : void 0),
      historyIndex: effect.historyIndex,
      historyDraft: effect.historyDraft
    } : current;
    stateRef.current = next;
    setState(next);
  });
  const insertImageToken = (token) => {
    const current = stateRef.current;
    const caret = clampCaretIndex(current.text, current.caretIndex);
    const next = {
      ...current,
      text: current.text.slice(0, caret) + token + current.text.slice(caret),
      prefixG: false,
      mentionSelectedIndex: 0,
      mentionDismissed: false,
      commandSelectedIndex: 0,
      commandDismissed: false,
      caretIndex: caret + token.length,
      historyIndex: void 0,
      historyDraft: void 0
    };
    stateRef.current = next;
    setState(next);
  };
  usePaste((pasted) => {
    controller.noteUserActivity();
    const current = stateRef.current;
    if (toolDetailsPaneRef.current.open || approvalPaneRef.current.open || askUserPaneRef.current.open || planReviewPaneRef.current.open || permissionPaneRef.current.open || settingsPaneRef.current.open && !settingsPaneRef.current.editing || agentHubPaneRef.current.open || planDirectoryPaneRef.current.open || workspacePaneRef.current.open && !workspacePaneRef.current.editing || feedbackPaneRef.current.open && !feedbackPaneRef.current.editing || workflowOverlayRef.current.open) return;
    const trimmed = pasted.trim();
    const extension = trimmed.slice(trimmed.lastIndexOf(".")).toLowerCase();
    if (trimmed !== "" && !trimmed.includes("\n") && !/[\u0000-\u001f]/.test(trimmed) && [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
      clearChord();
      void controller.intakeImagePath(pasted).then((result) => {
        if (result.ok) insertImageToken(result.token);
        else controller.note(result.reason);
      });
      return;
    }
    const caret = clampCaretIndex(current.text, current.caretIndex);
    const appended = current.text.slice(0, caret) + pasted + current.text.slice(caret);
    clearChord();
    if (searchRef.current.open) {
      controller.dispatch({ kind: "search", query: appended });
    }
    const next = {
      ...current,
      text: appended,
      commandQuery: appended.startsWith("/") ? appended.slice(1) : current.commandQuery,
      prefixG: false,
      mentionSelectedIndex: 0,
      mentionDismissed: false,
      commandSelectedIndex: 0,
      commandDismissed: false,
      caretIndex: caret + pasted.length,
      historyIndex: void 0,
      historyDraft: void 0
    };
    stateRef.current = next;
    setState(next);
  });
  const commandMode = (state.commandQuery !== void 0 || state.text.startsWith("/")) && state.commandDismissed !== true;
  const mentionQuery = activeMentionQuery(state.text);
  const mentionMode = mentionQuery !== void 0 && !state.mentionDismissed;
  useEffect3(() => {
    mentionAbortRef.current?.abort();
    if (!mentionMode) {
      setMentionCandidates([]);
      setMentionPhase("ready");
      return;
    }
    const seq = ++mentionSeqRef.current;
    const controllerAbort = new AbortController();
    mentionAbortRef.current = controllerAbort;
    setMentionCandidates([]);
    setMentionPhase("loading");
    void controller.listMentions(
      controller.getCwd(),
      mentionQuery,
      controllerAbort.signal
    ).then(
      (results) => {
        if (controllerAbort.signal.aborted || seq !== mentionSeqRef.current) return;
        setMentionCandidates(results);
        setMentionPhase("ready");
      },
      () => {
        if (controllerAbort.signal.aborted || seq !== mentionSeqRef.current) return;
        setMentionCandidates([]);
        setMentionPhase("ready");
      }
    );
    return () => {
      controllerAbort.abort();
    };
  }, [controller, mentionMode, mentionQuery]);
  const statusLabel = statusText(interaction);
  const statusOccupied = approvalPane.open || askUserPane.open;
  const identityStatus = badge === "" ? shortenHomePath(controller.getCwd(), homedir()) : `${shortenHomePath(controller.getCwd(), homedir())} \xB7 ${badge}`;
  const statsText = sessionStats === void 0 ? void 0 : `${sessionStats.turns} turns \xB7 ${sessionStats.decodeTokens} tok \xB7 ${sessionStats.llmMs} ms`;
  const scrollHint = statusHintText(interaction, statusOccupied);
  let restPlain = identityStatus;
  if (statusLabel !== "") {
    restPlain = scrollHint === "" ? statusLabel : `${statusLabel} \xB7 ${scrollHint}`;
  }
  let goalRuns;
  if (goalFooter !== void 0 && feedback === void 0) {
    const budget = Math.max(
      1,
      columns - displayWidth(`${goalFooterHead(goalFooter)} \xB7 `) - displayWidth(restPlain)
    );
    goalRuns = goalFooterRuns(goalFooter, budget);
  }
  const footerRowBudget = statusDetails ? rows >= 32 ? 3 : rows >= 12 ? 2 : 1 : 1;
  const detailsTip = statusLabel === "" ? `/ \u547D\u4EE4 \xB7 @ \u63D0\u53CA \xB7 Ctrl+O ${tuiCopy("reasoning", locale)} \xB7 /status ${tuiCopy("statusDetails", locale)}` : `${scrollHint} \xB7 Ctrl+O ${tuiCopy("reasoning", locale)} \xB7 /status ${tuiCopy("statusDetails", locale)}`;
  const adaptiveRows = adaptiveInfoFooter === void 0 ? [] : footerRowBudget === 1 ? [formatQuietStatusRow({
    ...adaptiveInfoFooter,
    locale,
    spinner: footerSpinner,
    reasoningVisible: model.reasoningExpanded,
    tip: statusLabel === "" ? void 0 : scrollHint
  }, columns)] : formatAdaptiveInfoFooterRows({
    ...adaptiveInfoFooter,
    locale,
    spinner: footerSpinner,
    reasoningVisible: model.reasoningExpanded,
    gitBranch: detectGitBranch(controller.getCwd()),
    environment: shortenHomePath(controller.getCwd(), homedir()),
    tip: detailsTip
  }, columns, footerRowBudget);
  let status;
  let statusRowCount;
  if (feedback !== void 0) {
    statusRowCount = 1;
    status = createElement2(
      Box24,
      {
        flexDirection: "column",
        width: "100%",
        backgroundColor: inkColor("bg")
      },
      createElement2(
        Text31,
        null,
        paintBackgroundRow([feedbackLine(feedback)], "bg", columns)
      )
    );
  } else if (adaptiveRows.length > 0) {
    const goalLine = goalRuns === void 0 ? void 0 : `${goalRuns.head} \xB7 ${goalRuns.objective}`;
    const visibleRows = adaptiveRows.map((row, index) => {
      if (index !== 0 || goalLine === void 0) return row;
      if (footerRowBudget === 1 && adaptiveInfoFooter !== void 0) {
        return formatQuietStatusRow({ ...adaptiveInfoFooter, locale, spinner: footerSpinner, tip: goalLine }, columns);
      }
      const baseText = row.runs.map((run) => run.text).join("");
      if (displayWidth(`${goalLine} \xB7 ${baseText}`) > columns) {
        const statusRun = row.runs.find((run) => run.text.startsWith(`${tuiCopy("status", locale)} `));
        if (statusRun === void 0) return row;
        const statusWidth = displayWidth(` \xB7 ${statusRun.text}`);
        const fittedGoal = truncateDisplay(goalLine, Math.max(1, columns - statusWidth));
        return {
          ...row,
          runs: [
            { text: fittedGoal, token: "fgDim" },
            { text: " \xB7 ", token: "fgDim" },
            statusRun
          ]
        };
      }
      return {
        ...row,
        runs: [
          { text: goalLine, token: "fgDim" },
          { text: " \xB7 ", token: "fgDim" },
          ...row.runs
        ]
      };
    });
    statusRowCount = visibleRows.length;
    status = createElement2(
      Box24,
      {
        flexDirection: "column",
        width: "100%",
        backgroundColor: inkColor("bg")
      },
      ...visibleRows.map((row, index) => createElement2(
        Text31,
        { key: `adaptive-footer-${String(index)}` },
        paintBackgroundRow(
          row.runs.map((run) => styled(run.text, run.token)),
          "bg",
          columns
        )
      ))
    );
  } else {
    const goal = goalRuns === void 0 ? void 0 : `${goalRuns.head} \xB7 ${goalRuns.objective}`;
    const workspace = [
      goal,
      escapeContent(shortenHomePath(controller.getCwd(), homedir())),
      statusLabel === "" ? "\u72B6\u6001 \u7A7A\u95F2" : statusLabel
    ].filter((part) => part !== void 0 && part !== "");
    const identity = [
      badge === "" ? void 0 : escapeContent(badge),
      statsText,
      statusLabel === "" ? "/ \u547D\u4EE4 \xB7 @ \u63D0\u53CA" : scrollHint
    ].filter((part) => part !== void 0 && part !== "");
    const visibleLines = [
      truncateDisplay(workspace.join(" \xB7 "), Math.max(1, columns)),
      truncateDisplay(identity.join(" \xB7 "), Math.max(1, columns))
    ].filter((line5) => line5 !== "");
    statusRowCount = visibleLines.length;
    status = createElement2(
      Box24,
      {
        flexDirection: "column",
        width: "100%",
        backgroundColor: inkColor("bg")
      },
      ...visibleLines.map((line5, index) => createElement2(
        Text31,
        { key: `fallback-footer-${String(index)}` },
        paintBackgroundRow([styled(line5, "fgDim")], "bg", columns)
      ))
    );
  }
  const viewportMotionPaused = pane.open || search.open || timelineOpen || modelPane.open || helpPane.open || toolDetailsPane.open || approvalPane.open || askUserPane.open || permissionPane.open || settingsPane.open || agentHubPane.open || planDirectoryPane.open || workspacePane.open || feedbackPane.open || workflowOverlay.open || planReviewPane.open;
  const brandBlocked = state.text !== "" || model.status !== "idle" || viewportMotionPaused;
  const brandLifecycleAllowed = !brandBlocked && (brandAnimationMode === "on" || brandAnimationMode === "auto" && brandAutoEligible);
  if (brandRevealStartedRef.current && !brandLifecycleAllowed) {
    brandRevealStoppedRef.current = true;
  } else if (brandLifecycleAllowed && !brandRevealStartedRef.current && !brandRevealStoppedRef.current) {
    brandRevealStartedRef.current = true;
  }
  const brandAnimation = brandLifecycleAllowed && brandRevealStartedRef.current && !brandRevealStoppedRef.current;
  const presenters = useMemo2(
    () => controller.getToolPresenters?.(),
    [controller]
  );
  const streamLayoutKey = useMemo2(() => ({}), [
    statusRowCount,
    state.text.split("\n").length,
    commandMode ? state.text : "",
    mentionMode ? state.text : "",
    approvalPane,
    askUserPane,
    planReviewPane,
    todoHud,
    jobsHud,
    workflowHud,
    composerHud,
    queuedDraftCount
  ]);
  const toolPaneRows = Math.max(4, rows - 3 - statusRowCount);
  const toolPageRows = Math.min((renderPolicy?.tools ?? toolPolicyDefaults()).detailPageRows, toolPaneRows - 3);
  toolDetailsSizeRef.current = { width: columns, pageRows: toolPageRows };
  const streamView = createElement2(StreamView, {
    locale,
    layoutKey: streamLayoutKey,
    model,
    presenters,
    brandTier,
    brandAnimation,
    scrollbar,
    brandFrameProbe,
    viewportCommand,
    renderPolicy,
    frameMetrics,
    motionPaused: viewportMotionPaused,
    mode: currentMode
  });
  const conversationColumns = conversationWidth(columns);
  const hudRows = [];
  if (todoHud !== void 0 && todoHud.length > 0) {
    hudRows.push(createElement2(TodoHud, { todos: todoHud, maxCols: conversationColumns }));
  }
  if (jobsHud !== void 0 && jobsHud.length > 0) {
    hudRows.push(createElement2(JobsHud, { jobs: jobsHud, maxCols: conversationColumns }));
  }
  if (workflowHud !== void 0) {
    hudRows.push(createElement2(WorkflowHud, { run: workflowHud, maxCols: conversationColumns }));
  }
  if (composerHud !== void 0 && composerHud !== "") {
    hudRows.push(createElement2(Text31, null, paintRow([styled(escapeContent(composerHud), "fg")])));
  }
  if (queuedDraftCount > 0) {
    hudRows.push(createElement2(QueueChip, { count: queuedDraftCount }));
  }
  const hasConversation = model.history.length > 0 || model.activeTurn !== void 0;
  const conversation = !hasConversation && hudRows.length === 0 ? streamView : createElement2(
    Box24,
    { flexDirection: "column", width: "100%", flexGrow: 1 },
    streamView,
    ...hudRows.length > 0 ? [
      createElement2(
        Box24,
        { key: "hud-rows", flexDirection: "column", alignItems: "center", width: "100%" },
        createElement2(Box24, { flexDirection: "column", width: conversationColumns }, ...hudRows)
      )
    ] : [],
    createElement2(Box24, { key: "conversation-gap", width: "100%", height: 1, flexShrink: 0 })
  );
  const overlayBrowseOpen = agentHubPane.open || planDirectoryPane.open || workspacePane.open || feedbackPane.open || workflowOverlay.open;
  let content;
  if (approvalPane.open || askUserPane.open || planReviewPane.open) {
    content = conversation;
  } else if (permissionPane.open) {
    content = createElement2(PermissionPane, {
      names: permissionPane.names,
      selectedIndex: permissionPane.selectedIndex,
      currentName: permissionPane.currentName,
      confirmDanger: permissionPane.confirmDanger,
      descriptions: permissionPane.descriptions,
      switchError: permissionPane.switchError
    });
  } else if (settingsPane.open) {
    const settingsEditingRows = settingsPane.editing ? state.text.split("\n").length + 1 : 0;
    const settingsMaxRows = Math.max(4, rows - 3 - statusRowCount - settingsEditingRows);
    content = createElement2(SettingsPane, {
      locale,
      rows: settingsPane.rows,
      selectedIndex: settingsPane.selectedIndex,
      editing: settingsPane.editing,
      maxRows: settingsMaxRows,
      ...settingsPane.onboarding === void 0 ? {} : { onboarding: settingsPane.onboarding },
      ...settingsPane.updateError === void 0 ? {} : { updateError: settingsPane.updateError }
    });
  } else if (modelPane.open) {
    content = createElement2(ModelPane, {
      filter: modelPane.filter,
      rows: modelPane.rows,
      selectedIndex: modelPane.selectedIndex,
      status: modelPane.status,
      ...modelPane.error === void 0 ? {} : { error: modelPane.error }
    });
  } else if (toolDetailsPane.open) {
    content = createElement2(ToolDetailsPane, { state: toolDetailsPane, columns, maxRows: toolPaneRows, pageRows: toolPageRows, locale });
  } else if (helpPane.open) {
    content = createElement2(HelpPane, {
      lines: helpPane.lines,
      offset: helpOffset
    });
  } else if (pane.open) {
    content = createElement2(SessionPane, {
      rows: pane.rows,
      selectedIndex: pane.selectedIndex,
      currentId: pane.currentId,
      confirmDelete: pane.confirmDelete,
      deleteUnavailable: pane.deleteUnavailable,
      columns,
      maxRows: rows - 3 - statusRowCount - (state.renaming ? state.text.split("\n").length + 1 : 0)
    });
  } else if (search.open) {
    content = createElement2(SearchPane, {
      query: search.query,
      results: search.results,
      selectedIndex: search.selectedIndex
    });
  } else if (timelineOpen) {
    content = createElement2(TimelineView, {
      history: model.history,
      offset: timelineOffset
    });
  } else if (agentHubPane.open) {
    content = createElement2(AgentHubPane, {
      rows: agentHubPane.rows,
      selectedIndex: agentHubPane.selectedIndex,
      view: agentHubPane.view,
      error: agentHubPane.error,
      transcript: agentHubPane.transcript,
      missing: agentHubPane.missing
    });
  } else if (planDirectoryPane.open) {
    content = createElement2(PlanDirectoryPane, {
      selectedIndex: planDirectoryPane.selectedIndex,
      currentActive: planDirectoryPane.currentActive,
      switchError: planDirectoryPane.switchError,
      statusError: planDirectoryPane.statusError
    });
  } else if (workspacePane.open) {
    content = createElement2(WorkspacePane, { state: workspacePane, maxCols: columns });
  } else if (feedbackPane.open) {
    content = createElement2(FeedbackPane, { state: feedbackPane });
  } else if (workflowOverlay.open) {
    content = createElement2(WorkflowOverlay, { state: workflowOverlay });
  } else {
    content = conversation;
  }
  const inputBar = (props) => createElement2(InputBar, {
    locale,
    modelChip: adaptiveInfoFooter?.model,
    modeChip: currentMode,
    ...props,
    rowsBelow: (props.rowsBelow ?? 0) + statusRowCount + 1
  });
  let inputSlot;
  if (approvalPane.open) {
    inputSlot = createElement2(
      Box24,
      { flexDirection: "column", width: "100%" },
      createElement2(ApprovalPane, {
        toolName: approvalPane.toolName,
        reason: approvalPane.reason,
        arguments: approvalPane.arguments,
        detailsOpen: approvalPane.detailsOpen,
        deliveryError: approvalPane.deliveryError
      }),
      inputBar({
        text: state.text,
        commandMode,
        mentionMode,
        caretIndex: state.caretIndex
      })
    );
  } else if (askUserPane.open) {
    inputSlot = createElement2(AskUserPane, {
      header: askUserPane.header,
      options: askUserPane.options,
      selectedIndex: askUserPane.selectedIndex
    });
  } else if (planReviewPane.open) {
    inputSlot = createElement2(PlanReviewPane, {
      plan: planReviewPane.plan,
      offset: planReviewOffset,
      deliveryError: planReviewPane.deliveryError
    });
  } else if ((permissionPane.open || overlayBrowseOpen) && !(workspacePane.open && workspacePane.editing) && !(feedbackPane.open && feedbackPane.editing)) {
    inputSlot = null;
  } else if (settingsPane.open && !settingsPane.editing) {
    inputSlot = null;
  } else if (modelPane.open || pane.open && state.renaming || search.open || settingsPane.editing || workspacePane.open && workspacePane.editing || feedbackPane.open && feedbackPane.editing) {
    inputSlot = inputBar({
      text: state.text,
      commandMode: false,
      mentionMode: false,
      caretIndex: state.caretIndex
    });
  } else if (toolDetailsPane.open) {
    inputSlot = void 0;
  } else if (helpPane.open) {
    inputSlot = null;
  } else if (pane.open) {
    inputSlot = null;
  } else if (commandMode) {
    const query = state.commandQuery ?? state.text.slice(1);
    const menuRows = Math.min(
      filterCommands(controller.commands, query).length,
      COMMAND_MENU_WINDOW
    );
    inputSlot = createElement2(
      Box24,
      { flexDirection: "column", width: "100%" },
      inputBar({
        text: state.text,
        commandMode,
        mentionMode,
        caretIndex: state.caretIndex,
        rowsBelow: menuRows
      }),
      createElement2(CommandMenu, {
        items: controller.commands,
        query,
        selectedIndex: state.commandSelectedIndex
      })
    );
  } else if (mentionMode) {
    const mentionRows = mentionPhase === "loading" || mentionCandidates.length === 0 ? 1 : mentionCandidates.length + new Set(mentionCandidates.map((candidate) => candidate.kind)).size;
    inputSlot = createElement2(
      Box24,
      { flexDirection: "column", width: "100%" },
      inputBar({
        text: state.text,
        commandMode,
        mentionMode,
        caretIndex: state.caretIndex,
        rowsBelow: mentionRows
      }),
      createElement2(Mention, {
        phase: mentionPhase,
        candidates: mentionCandidates,
        selectedIndex: state.mentionSelectedIndex
      })
    );
  } else {
    inputSlot = inputBar({
      text: state.text,
      commandMode,
      mentionMode,
      caretIndex: state.caretIndex
    });
  }
  return createElement2(AppShell, {
    title: liveTitle === "" ? title : liveTitle,
    badge: adaptiveInfoFooter === void 0 ? badge : shortenHomePath(controller.getCwd(), homedir()),
    status,
    children: content,
    input: inputSlot
  });
}

// tui-render/src/react-timing.ts
import { performance as performance2, PerformanceObserver } from "node:perf_hooks";
function isReactTiming(entry) {
  if (entry.entryType !== "measure" || !("detail" in entry)) return false;
  const detail = entry.detail;
  if (typeof detail !== "object" || detail === null || !("devtools" in detail)) return false;
  const devtools = detail.devtools;
  return typeof devtools === "object" && devtools !== null && ("track" in devtools && devtools.track === "Components \u269B" || "trackGroup" in devtools && devtools.trackGroup === "Scheduler \u269B");
}
function observeReactTiming() {
  const release = (entries) => {
    const names = new Set(entries.filter(isReactTiming).map((entry) => entry.name));
    for (const name of names) {
      if (performance2.getEntriesByName(name, "measure").every(isReactTiming)) performance2.clearMeasures(name);
    }
  };
  const observer = new PerformanceObserver((list) => {
    release(list.getEntries());
  });
  observer.observe({ entryTypes: ["measure"] });
  return () => {
    release(observer.takeRecords());
    observer.disconnect();
  };
}

// tui-render/src/message-visibility.ts
function isHumanUserMessage(event) {
  return event.type === "user/message" && event.data.source.kind === "user";
}

// tui-render/src/projection.ts
import { BlockAssembler } from "@deepseek-ai/dsh-llm";
import { deriveTurnTokenUsage } from "@deepseek-ai/dsh-token-meter/client";
import { deepFreeze } from "@deepseek-ai/dsh-util-values";
function lastFencedCode(text) {
  const lines = text.split(/\r?\n/u);
  let openingLength;
  let bodyStart = 0;
  let latest;
  for (const [index, line5] of lines.entries()) {
    if (openingLength === void 0) {
      const opening = /^ {0,3}(`{3,})[^`]*$/u.exec(line5);
      if (opening !== null) {
        openingLength = opening[1].length;
        bodyStart = index + 1;
      }
      continue;
    }
    const closing = /^ {0,3}(`{3,})[ \t]*$/u.exec(line5);
    if (closing === null || closing[1].length < openingLength) continue;
    latest = lines.slice(bodyStart, index).join("\n");
    openingLength = void 0;
  }
  return latest;
}
function latestAssistantCopyTarget(history) {
  const message = history.findLast((row) => row.kind === "assistant" && row.text !== "");
  if (message === void 0) return void 0;
  const code = lastFencedCode(message.text);
  return code === void 0 ? { kind: "message", text: message.text } : { kind: "code", text: code };
}
var EMPTY_VIEW = {
  history: [],
  compactionDividers: [],
  expandedCompactionId: void 0,
  activeTurn: void 0,
  status: "idle",
  reasoningExpanded: false,
  toolCardsExpanded: false
};
function projectUserContent(blocks) {
  let imageOrdinal = 0;
  return blocks.map((block) => {
    switch (block.type) {
      case "text":
        return block.text;
      case "image": {
        imageOrdinal += 1;
        const suffix = block.attachment.name === void 0 ? "" : ` \xB7 ${block.attachment.name}`;
        return `[\u56FE\u7247 #${String(imageOrdinal)}${suffix}]`;
      }
      default:
        return "";
    }
  }).join("");
}
function projectAssistantBlocks(blocks) {
  const content = [];
  const toolCalls = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        content.push({ kind: "text", text: block.text });
        break;
      case "reasoning":
        content.push({ kind: "reasoning", text: block.text, durationMs: 0 });
        break;
      case "tool-call":
        toolCalls.push({
          callId: block.id,
          name: block.name,
          arguments: block.arguments
        });
        break;
      default:
        break;
    }
  }
  return { content, toolCalls };
}
function contentText(content, kind) {
  return content.filter((item) => item.kind === kind).map((item) => item.text).join("");
}
function formatTurnError(error) {
  const rawMessage = error.message || "\u672A\u77E5\u9519\u8BEF";
  const code = error.code;
  const status = error.status;
  if (rawMessage.includes("sk-") && (rawMessage.includes("apiKeyEnv") || rawMessage.includes("store sk-") || rawMessage.includes("export sk-"))) {
    return "\u26A0\uFE0F **\u914D\u7F6E\u9519\u8BEF**\uFF1A\u68C0\u6D4B\u5230 `apiKeyEnv` \u4E2D\u8BEF\u586B\u4E86\u660E\u6587\u5BC6\u94A5\u3002`apiKeyEnv` \u5FC5\u987B\u662F\u73AF\u5883\u53D8\u91CF\u540D\u79F0\uFF08\u5982 `DEEPSEEK_API_KEY`\uFF09\u3002\u8BF7\u5728 `/settings` \u4E2D\u66F4\u6B63\u6216\u68C0\u67E5 `~/.dsh/settings.yaml`\uFF0C\u5E76\u4F7F\u7528 `/key` \u547D\u4EE4\u914D\u7F6E\u5BC6\u94A5\u3002";
  }
  if (code === "MISSING_CREDENTIAL" || rawMessage.includes("DEEPSEEK_API_KEY") || rawMessage.includes("MISSING_CREDENTIAL") || rawMessage.includes("no API key")) {
    return '\u26A0\uFE0F **API \u5BC6\u94A5\u7F3A\u5931**\uFF1A\u672A\u68C0\u6D4B\u5230\u6709\u6548\u5BC6\u94A5\u3002\u8BF7\u5728\u7EC8\u7AEF\u6267\u884C `export DEEPSEEK_API_KEY="sk-..."` \u6216\u8F93\u5165 `/key` \u547D\u4EE4\u8FDB\u884C\u914D\u7F6E\u3002';
  }
  if (status === 401 || code === "AUTH" || rawMessage.includes("401") || rawMessage.toLowerCase().includes("authentication fails") || rawMessage.toLowerCase().includes("invalid api key") || rawMessage.toLowerCase().includes("unauthorized")) {
    return `\u26A0\uFE0F **API \u8BA4\u8BC1\u5931\u8D25\uFF08HTTP 401\uFF09**\uFF1AAPI Key \u65E0\u6548\u6216\u672A\u6388\u6743\uFF08${rawMessage}\uFF09\u3002\u8BF7\u68C0\u67E5\u5BC6\u94A5\u662F\u5426\u6B63\u786E\uFF0C\u6216\u4F7F\u7528 \`/key\` \u91CD\u65B0\u914D\u7F6E\u3002`;
  }
  if (status === 429 || code === "RATE_LIMIT" || rawMessage.includes("429") || rawMessage.toLowerCase().includes("quota") || rawMessage.toLowerCase().includes("rate limit")) {
    return `\u26A0\uFE0F **\u8BF7\u6C42\u53D7\u9650\uFF08HTTP 429\uFF09**\uFF1A\u8BF7\u6C42\u9891\u7387\u8D85\u9650\u6216\u8D26\u6237\u4F59\u989D\u4E0D\u8DB3\uFF08${rawMessage}\uFF09\u3002\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u68C0\u67E5\u8D26\u6237\u989D\u5EA6\u3002`;
  }
  if (rawMessage.includes("ECONNREFUSED") || rawMessage.includes("ETIMEDOUT") || rawMessage.includes("ENOTFOUND") || rawMessage.includes("fetch failed")) {
    return `\u26A0\uFE0F **\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25**\uFF1A\u65E0\u6CD5\u8FDE\u63A5\u5230\u6A21\u578B\u670D\u52A1\uFF08${rawMessage}\uFF09\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8FDE\u63A5\u6216\u4EE3\u7406\u914D\u7F6E\u3002`;
  }
  return `\u26A0\uFE0F **\u6A21\u578B\u8BF7\u6C42\u5931\u8D25**\uFF1A${rawMessage}`;
}
function createProjector() {
  const history = [];
  const compactionDividers = [];
  let assembler;
  let activeTurn;
  let status = "idle";
  let turnStartedAt = 0;
  let turnEventAt = 0;
  let stepStartedAt = 0;
  let lastUsageOutputTokens;
  let lastStepWallMs;
  let assistantTurnCount = 0;
  let turnEvents = [];
  let turnContent = [];
  let stepContent = [];
  let stepToolCalls = [];
  let stepCommitted = true;
  const reasoningStarts = [];
  const reasoningEnds = [];
  function appendHistory(message) {
    history.push(deepFreeze(message));
  }
  function appendCompaction(divider) {
    compactionDividers.push(deepFreeze(divider));
  }
  function stampReasoningDurations(content) {
    let index = 0;
    const stamped = content.map((item, itemIndex) => {
      if (item.kind !== "reasoning") return item;
      if (reasoningStarts[index] === void 0) {
        if (index > 0 && reasoningEnds[index - 1] === void 0) {
          reasoningEnds[index - 1] = turnEventAt;
        }
        reasoningStarts[index] = turnEventAt;
      }
      const laterNonReasoning = content.slice(itemIndex + 1).some((next) => next.kind !== "reasoning");
      if (laterNonReasoning && reasoningEnds[index] === void 0) {
        reasoningEnds[index] = turnEventAt;
      }
      const start = reasoningStarts[index];
      const end = reasoningEnds[index] ?? turnEventAt;
      index += 1;
      return {
        kind: "reasoning",
        text: item.text,
        durationMs: Math.max(0, end - start)
      };
    });
    reasoningStarts.length = index;
    reasoningEnds.length = index;
    return stamped;
  }
  function updateActiveTurn() {
    const current = activeTurn;
    const content = stampReasoningDurations([...turnContent, ...stepContent]);
    current.assistantText = contentText(content, "text");
    current.reasoningText = contentText(content, "reasoning");
    current.content = content;
    current.toolCalls = [
      ...turnContent.filter((item) => item.kind === "tool-call").map(({ callId, name, arguments: args }) => ({ callId, name, arguments: args })),
      ...stepToolCalls
    ];
    const lastReasoning = content.findLast((item) => item.kind === "reasoning");
    current.reasoningDurationMs = lastReasoning?.durationMs ?? Math.max(0, turnEventAt - turnStartedAt);
  }
  function commitStep() {
    if (stepCommitted) return;
    turnContent.push(...stepContent);
    stepContent = [];
    stepToolCalls = [];
    stepCommitted = true;
    updateActiveTurn();
  }
  function replaceStep(blocks) {
    const projected = projectAssistantBlocks(blocks);
    stepContent = projected.content;
    stepToolCalls = projected.toolCalls;
    stepCommitted = false;
    updateActiveTurn();
  }
  function push(event) {
    if (event.type === "turn/start") turnEvents = [event];
    else if (activeTurn !== void 0) turnEvents.push(event);
    if (activeTurn !== void 0) turnEventAt = event.time;
    switch (event.type) {
      case "turn/start": {
        assembler = new BlockAssembler();
        turnContent = [];
        stepContent = [];
        stepToolCalls = [];
        stepCommitted = false;
        reasoningStarts.length = 0;
        reasoningEnds.length = 0;
        activeTurn = {
          turn: event.data.turn,
          assistantText: "",
          reasoningText: "",
          toolCalls: [],
          content: [],
          reasoningDurationMs: 0
        };
        status = "generating";
        turnStartedAt = event.time;
        turnEventAt = event.time;
        return;
      }
      case "step/start": {
        if (activeTurn === void 0) return;
        commitStep();
        assembler = new BlockAssembler();
        stepContent = [];
        stepToolCalls = [];
        stepCommitted = false;
        stepStartedAt = event.time;
        return;
      }
      case "user/message": {
        if (!isHumanUserMessage(event)) return;
        const text = projectUserContent(event.data.content);
        appendHistory({ id: event.seq, kind: "user", text, timestamp: event.time });
        return;
      }
      case "assistant/chunk": {
        if (activeTurn === void 0) return;
        assembler ??= new BlockAssembler();
        assembler.push(event.data.chunk);
        replaceStep(assembler.blocks());
        return;
      }
      case "assistant/message": {
        if (activeTurn !== void 0) {
          replaceStep(event.data.message.content);
          commitStep();
          lastUsageOutputTokens = event.data.usage?.outputTokens;
          lastStepWallMs = Math.max(0, event.time - stepStartedAt);
        }
        return;
      }
      case "compaction/start": {
        appendCompaction({
          id: event.seq,
          compactionId: event.data.compactionId,
          summary: ""
        });
        return;
      }
      case "compaction/summary": {
        const index = compactionDividers.findLastIndex(
          (divider) => divider.compactionId === event.data.compactionId
        );
        if (index < 0) return;
        const current = compactionDividers[index];
        compactionDividers[index] = deepFreeze({
          ...current,
          shadowedCount: event.data.shadowedSeqs.length,
          summary: event.data.summary.filter((block) => block.type === "text").map((block) => block.text).join("")
        });
        return;
      }
      case "tool/call": {
        if (activeTurn === void 0) return;
        commitStep();
        turnContent.push({
          kind: "tool-call",
          callId: event.data.callId,
          name: event.data.name,
          arguments: event.data.arguments
        });
        updateActiveTurn();
        return;
      }
      case "tool/result": {
        if (activeTurn === void 0) return;
        commitStep();
        const block = event.data.message.content[0];
        turnContent.push({
          kind: "tool-result",
          callId: block.toolCallId,
          text: block.content.filter((item) => item.type === "text").map((item) => item.text).join(""),
          isError: block.isError ?? false,
          ...event.data.error === void 0 ? {} : { error: { ...event.data.error } },
          ...event.data.meta === void 0 ? {} : { meta: structuredClone(event.data.meta) }
        });
        updateActiveTurn();
        return;
      }
      case "step/end": {
        commitStep();
        return;
      }
      case "turn/end": {
        if (activeTurn !== void 0) {
          commitStep();
          activeTurn.reason = event.data.reason;
          updateActiveTurn();
          let turnUsage;
          try {
            turnUsage = deriveTurnTokenUsage(turnEvents);
          } catch {
            turnUsage = void 0;
          }
          const reason = event.data.reason;
          if (turnContent.length > 0 || reason.kind === "error") {
            assistantTurnCount += 1;
            let text = activeTurn.assistantText;
            const content = activeTurn.content.map((item) => ({ ...item }));
            if (reason.kind === "error") {
              const formattedError = formatTurnError(reason.error);
              if (text.trim() === "") {
                text = formattedError;
                content.push({ kind: "text", text: formattedError });
              } else {
                text += `

${formattedError}`;
                content.push({ kind: "text", text: `

${formattedError}` });
              }
            }
            appendHistory({
              id: event.seq,
              kind: "assistant",
              text,
              reasoningText: activeTurn.reasoningText,
              reasoningDurationMs: activeTurn.reasoningDurationMs,
              // activeTurn.content is the stamped fold: raw turnContent items
              // still carry durationMs 0 from projectAssistantBlocks.
              content,
              timestamp: event.time,
              ...lastUsageOutputTokens === void 0 ? {} : { usageOutputTokens: lastUsageOutputTokens },
              ...lastStepWallMs === void 0 ? {} : { stepWallMs: lastStepWallMs },
              ...turnUsage === void 0 ? {} : { turnUsage },
              turnOrdinal: assistantTurnCount
            });
          }
          activeTurn = void 0;
          lastUsageOutputTokens = void 0;
          lastStepWallMs = void 0;
          turnEvents = [];
        }
        status = "idle";
        return;
      }
      default:
        return;
    }
  }
  return {
    push,
    seed(events) {
      if (!events || typeof events[Symbol.iterator] !== "function") return;
      for (const event of events) push(event);
    },
    snapshot() {
      return {
        history,
        compactionDividers,
        expandedCompactionId: void 0,
        activeTurn,
        status,
        reasoningExpanded: false,
        toolCardsExpanded: false
      };
    }
  };
}

// tui-render/src/render-loop.ts
function createRenderLoop(render2, intervalMs = 20) {
  let latest;
  let hasPending = false;
  let timer;
  const flush = () => {
    if (!hasPending) return;
    hasPending = false;
    render2(latest);
  };
  timer = setInterval(flush, intervalMs);
  return {
    enqueue(model) {
      latest = model;
      hasPending = true;
    },
    stop() {
      if (timer !== void 0) clearInterval(timer);
      timer = void 0;
      flush();
    }
  };
}
function withThrottle(fn, intervalMs = 20) {
  let lastRun = 0;
  let pending;
  return (...args) => {
    const now = Date.now();
    if (now - lastRun >= intervalMs) {
      lastRun = now;
      fn(...args);
      pending = void 0;
    } else {
      pending = args;
      setTimeout(
        () => {
          if (pending !== void 0) {
            fn(...pending);
            pending = void 0;
          }
        },
        intervalMs - (now - lastRun)
      );
    }
  };
}

// tui-render/src/interaction-state.ts
function reduceInteraction(state, event) {
  switch (state) {
    case "idle":
    case "stopped": {
      if (event.kind === "sigint") {
        return { state: "exit-armed", effect: { kind: "arm-exit" } };
      }
      if (event.kind === "send") {
        return {
          state: "generating",
          effect: { kind: "followup", text: event.text }
        };
      }
      return { state, effect: { kind: "none" } };
    }
    case "generating": {
      if (event.kind === "sigint") {
        return { state: "generating", effect: { kind: "cancel-generation" } };
      }
      if (event.kind === "turn-ended") {
        return event.completed ? { state: "idle", effect: { kind: "none" } } : { state: "stopped", effect: { kind: "none" } };
      }
      return { state, effect: { kind: "none" } };
    }
    case "exit-armed": {
      if (event.kind === "sigint") {
        return { state: "exit-armed", effect: { kind: "exit", code: 0 } };
      }
      if (event.kind === "send") {
        return {
          state: "generating",
          effect: { kind: "followup", text: event.text }
        };
      }
      return { state, effect: { kind: "none" } };
    }
  }
}

// tui-render/src/index.ts
if (typeof globalThis.React === "undefined") {
  ;
  globalThis.React = React;
}
function mountTuiRender(node, options = {}) {
  const env = options.env ?? process.env;
  const policy = options.renderPolicy ?? renderPolicyDefaults();
  installTheme(env);
  setHyperlinks(detectHyperlinks(env));
  const wrapped = options.frameProbe === void 0 ? node : createElement3(FrameProbe, { probe: options.frameProbe }, node);
  const mouse = attachMouseIo({
    stdin: options.stdin ?? process.stdin,
    stdout: options.stdout ?? process.stdout,
    ...options.renderPolicy === void 0 ? {} : { wheelRows: options.renderPolicy.scroll.wheelRows }
  });
  const releaseTiming = observeReactTiming();
  let instance;
  try {
    instance = render(wrapped, {
      alternateScreen: true,
      incrementalRendering: false,
      patchConsole: false,
      exitOnCtrlC: options.exitOnCtrlC ?? false,
      maxFps: 1e3 / Math.min(policy.scroll.frameIntervalMs, policy.stream.frameIntervalMs),
      stdout: wrapStdoutForFrameBg(mouse.stdout, currentTier, options.frameMetrics),
      stdin: mouse.stdin
    });
  } catch (error) {
    releaseTiming();
    mouse.dispose();
    throw error;
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    try {
      instance.unmount();
    } finally {
      releaseTiming();
      mouse.dispose();
    }
  };
}
function mountTuiFrame(options, mountOptions) {
  return mountTuiRender(
    createElement3(AppShell, {
      title: options.title,
      badge: options.badge,
      children: createElement3(Text32, null, options.content)
    }),
    mountOptions
  );
}
function TuiApp(props) {
  const { title, badge, model } = props;
  return createElement3(AppShell, {
    title,
    badge,
    children: createElement3(StreamView, { model }),
    status: createElement3(
      Text32,
      null,
      model.status === "generating" ? `\u23F9 Ctrl+C \u505C\u6B62 \xB7 ${STATUS_HINT}` : model.status === "stopped" ? `\u7EE7\u7EED\u751F\u6210 \xB7 ${STATUS_HINT}` : ""
    )
  });
}
function mountTuiLoop(controller, options) {
  const {
    title,
    brandFrameProbe,
    renderPolicy,
    frameMetrics,
    ...mountOptions
  } = options;
  const env = mountOptions.env ?? process.env;
  const stdout = mountOptions.stdout ?? process.stdout;
  const stdin = mountOptions.stdin ?? process.stdin;
  return mountTuiRender(
    createElement3(TuiLoop, {
      title,
      controller,
      brandTier: detectBrandRenderTier(env),
      brandAutoEligible: stdout.isTTY && stdin.isTTY,
      brandFrameProbe,
      frameProbe: mountOptions.frameProbe,
      renderPolicy,
      frameMetrics
    }),
    {
      ...mountOptions,
      ...frameMetrics === void 0 ? {} : { frameMetrics }
    }
  );
}
export {
  AgentHubPane,
  AppShell,
  ApprovalPane,
  AskUserPane,
  BRAILLE_SPINNER_FRAMES,
  BRAND_APP_TITLE,
  BRAND_ART_ROWS,
  BRAND_ASCII,
  BRAND_FRAME_MS,
  BRAND_FULL_BLOCK,
  BRAND_HALF_BLOCK,
  BRAND_HALF_BLOCK_FRAMES,
  BRAND_HOME_LINE,
  BRAND_HOME_ROWS,
  BRAND_MIN_HOME_ROWS,
  BRAND_PLAIN_WORDMARK,
  CodeBlock,
  CommandMenu,
  EMPTY_APPROVAL_PANE,
  EMPTY_ASK_USER_PANE,
  EMPTY_FEEDBACK_PANE,
  EMPTY_INPUT,
  EMPTY_OVERLAY_PANE,
  EMPTY_PERMISSION_PANE,
  EMPTY_PLAN_DIRECTORY_PANE,
  EMPTY_PLAN_REVIEW_PANE,
  EMPTY_SETTINGS_PANE,
  EMPTY_TOOL_DETAILS_PANE,
  EMPTY_TRANSCRIPT_VIEWPORT,
  EMPTY_VIEW,
  EMPTY_WORKFLOW_OVERLAY,
  EMPTY_WORKSPACE_PANE,
  FRAME_METRICS_CAPACITY,
  FRAME_STATS_CAPACITY,
  FeedbackPane,
  FrameProbe,
  HELP_WINDOW,
  HelpPane,
  HighlightedLine,
  InputBar,
  JobsHud,
  MODEL_WINDOW,
  MarkdownBlock,
  Mention,
  ModelPane,
  NARROW_TO_WIDE_EMOJIS,
  OSC52_MAX_CHARS,
  OverlayShell,
  PLAN_REVIEW_WINDOW,
  PermissionPane,
  PixelFishHome,
  PlanDirectoryPane,
  PlanReviewPane,
  QueueChip,
  RENDER_POLICY_DEFAULT_CACHE_MAX_BYTES,
  RENDER_POLICY_DEFAULT_CACHE_MAX_ROWS,
  RENDER_POLICY_DEFAULT_SCROLL_CATCH_UP_THRESHOLD,
  RENDER_POLICY_DEFAULT_SCROLL_FRAME_INTERVAL_MS,
  RENDER_POLICY_DEFAULT_SCROLL_MAX_CATCH_UP_STEP,
  RENDER_POLICY_DEFAULT_SCROLL_STEP_PER_FRAME,
  RENDER_POLICY_DEFAULT_SCROLL_WHEEL_ROWS,
  RENDER_POLICY_DEFAULT_STREAM_CATCH_UP_ROWS_PER_FRAME,
  RENDER_POLICY_DEFAULT_STREAM_ENTRY_DEPTH,
  RENDER_POLICY_DEFAULT_STREAM_ENTRY_DRAIN_BACKPRESSURE_MS,
  RENDER_POLICY_DEFAULT_STREAM_ENTRY_OLDEST_AGE_MS,
  RENDER_POLICY_DEFAULT_STREAM_EXIT_DEPTH,
  RENDER_POLICY_DEFAULT_STREAM_EXIT_DRAIN_BACKPRESSURE_MS,
  RENDER_POLICY_DEFAULT_STREAM_EXIT_OLDEST_AGE_MS,
  RENDER_POLICY_DEFAULT_STREAM_FRAME_INTERVAL_MS,
  RENDER_POLICY_DEFAULT_TRANSCRIPT_OVERSCAN,
  RENDER_POLICY_MAX_CACHE_BYTES,
  RENDER_POLICY_MAX_CACHE_ROWS,
  RENDER_POLICY_MAX_OVERSCAN,
  ReasoningBlock,
  SEARCH_WINDOW,
  SETTINGS_WINDOW,
  SWIMMING_FISH_FRAMES,
  SearchPane,
  SessionPane,
  SettingsPane,
  StreamView,
  THEME_LEVELS,
  TIMELINE_WINDOW,
  TimelineView,
  TodoHud,
  ToolCard,
  ToolDetailsPane,
  ToolPresenterCache,
  TranscriptLayoutCache,
  TuiApp,
  TuiLoop,
  WORKFLOW_OVERLAY_WINDOW,
  WorkflowHud,
  WorkflowOverlay,
  WorkspacePane,
  activeBrandRevealTimerCount,
  applyTheme,
  attachPresenterViews,
  bgSequence,
  cardsFrom,
  cardsFromActiveTurn,
  cardsFromTurn,
  collapsedCardSummary,
  completeFirst,
  composerCursorPosition,
  composerFrameAnchor,
  computeSettingsWindow,
  conversationLeft,
  conversationWidth,
  copyText,
  createFrameMetrics,
  createFrameProbe,
  createFrameSnapshotRow,
  createProjector,
  createRenderLoop,
  createToolBodyDocument,
  currentTier,
  detectBrandRenderTier,
  detectNotifyCapability,
  diffVisibleFrameSnapshots,
  displayWidth,
  encodeOsc52,
  escapeContent,
  filterCommands,
  formatAdaptiveInfoFooter,
  formatAdaptiveInfoFooterRows,
  formatCompactTokens,
  formatGoalFooter,
  formatQuietStatusRow,
  formatSeconds,
  formatSymbolSpacing,
  frameStatsSnapshot,
  getBrailleSpinnerFrame,
  getSwimmingFishFrame,
  goalFooterHead,
  goalFooterRuns,
  handleInput,
  hideFrameCaret,
  hostClipboardCommand,
  inkColor,
  installTheme,
  isHumanUserMessage,
  latestAssistantCopyTarget,
  layoutTitleBar,
  mountTuiFrame,
  mountTuiLoop,
  mountTuiRender,
  notifyBytes,
  paintBackgroundRow,
  paintRow,
  parseSubagentArguments,
  physicalLineIdentity,
  physicalScrollRailGeometry,
  planToolBodyWindow,
  queueChipText,
  reduceInteraction,
  reduceTranscriptViewport,
  relativeTime,
  renderPolicyDefaults,
  renderToString,
  resolveEnterQuery,
  selectBrandRenderTier,
  setFrameCaret,
  setFrameRail,
  setVisibleFrameSnapshot,
  styled,
  tokenize,
  toolCardOriginalText,
  toolPolicyDefaults,
  transformFrameChunk,
  truncateDisplay,
  tuiCopy,
  visibleFrameSnapshot,
  wcwidthSafeSlice,
  withThrottle,
  wrapStdoutForFrameBg,
  writePublishedFrameRail
};
