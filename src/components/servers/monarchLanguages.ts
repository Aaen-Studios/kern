/**
 * Custom Monarch language definitions for file types Monaco doesn't ship with
 * natively. These provide real syntax coloring (comments, keys, values,
 * escapes, etc.) without a full language server.
 *
 * Each definition is a lightweight Monarch tokenizer — a state machine that
 * emits token types matching the rules in editorTheme.ts. Register them once
 * at app startup via `registerCustomLanguages(monaco)`.
 *
 * Languages defined here:
 *   - env       → .env, .env.* (KEY=value, export, comments, variable refs)
 *   - properties → .properties (Java-style key=value, escapes, continuations)
 *   - ignore    → .gitignore, .dockerignore, .gitattributes (patterns, negation)
 *   - ini       → .ini, .cfg, .conf (sections, key=value, comments)
 *   - log       → .log (timestamps, levels, IPs, stack traces)
 */

import type { languages } from "monaco-editor";

/**
 * Monarch definition for `.env` / `.env.*` files.
 *
 * Tokenizes:
 *   - `# comment`           → env-comment
 *   - `export`              → env-keyword
 *   - `KEY=value`           → env-key, env-separator, env-value
 *   - `${VAR}` / `$VAR`     → env-variable (inside values)
 *   - `"quoted"` / `'quoted'` → env-string
 */
const envLanguage: languages.IMonarchLanguage = {
  ignoreCase: false,
  tokenizer: {
    root: [
      // Comments
      [/#.*$/, "env-comment"],

      // export keyword
      [/^export\s+/, "env-keyword", "@lineStart"],

      // KEY=value pattern
      [
        /([A-Za-z_][A-Za-z0-9_]*)\s*(=|:)\s*/,
        {
          cases: {
            "$1": ["env-key", "env-separator"],
          },
        },
        "@value",
      ],

      // Fallback: anything else
      [/.*$/, "env-value"],
    ],

    lineStart: [
      // After `export`, expect a KEY=value
      [
        /([A-Za-z_][A-Za-z0-9_]*)\s*(=|:)\s*/,
        {
          cases: {
            "$1": ["env-key", "env-separator"],
          },
        },
        "@value",
      ],
      [/.*$/, "env-value"],
    ],

    value: [
      // Variable references: ${VAR} or $VAR
      [/\$\{[^}]+\}/, "env-variable"],
      [/\$[A-Za-z_][A-Za-z0-9_]*/, "env-variable"],

      // Double-quoted string
      [/"/, "env-string", "@doubleQuotedString"],

      // Single-quoted string
      [/'/, "env-string", "@singleQuotedString"],

      // End of value (rest of line)
      [/\s*$/, "", "@pop"],
      [/.*$/, "env-value"],
    ],

    doubleQuotedString: [
      [/[^\\"]+/, "env-string"],
      [/\\./, "env-variable"],
      [/"/, "env-string", "@pop"],
    ],

    singleQuotedString: [
      [/[^\\']+/, "env-string"],
      [/\\./, "env-variable"],
      [/'/, "env-string", "@pop"],
    ],
  },
};

/**
 * Monarch definition for Java `.properties` files.
 *
 * Tokenizes:
 *   - `# comment` / `! comment`  → properties-comment
 *   - `key=value` / `key:value` / `key value` → properties-key, properties-separator, properties-value
 *   - `\n`, `\t`, `\uXXXX`       → properties-escape
 *   - trailing `\` (continuation) → properties-continuation
 */
const propertiesLanguage: languages.IMonarchLanguage = {
  ignoreCase: false,
  tokenizer: {
    root: [
      // Comments
      [/#.*$/, "properties-comment"],
      [/!.*$/, "properties-comment"],

      // Key = value / key : value
      [/^([^=:!#\s\\]+?)\s*([=:])\s*/, ["properties-key", "properties-separator"], "@value"],

      // Key with whitespace separator (no = or :)
      [/^([^=:!#\s\\]+?)\s+/, ["properties-key", ""], "@value"],

      // Fallback
      [/.*$/, "properties-value"],
    ],

    value: [
      // Escaped characters
      [/\\[nrtu\\]/, "properties-escape"],
      [/\\u[0-9a-fA-F]{4}/, "properties-escape"],

      // Line continuation
      [/\\\s*$/, "properties-continuation"],

      // End of value
      [/\s*$/, "", "@pop"],
      [/.*$/, "properties-value"],
    ],
  },
};

/**
 * Monarch definition for `.gitignore`, `.dockerignore`, `.gitattributes`.
 *
 * Tokenizes:
 *   - `# comment`           → ignore-comment
 *   - `!pattern`            → ignore-negation
 *   - `dir/`                → ignore-directory
 *   - `*`, `?`, `**`        → ignore-wildcard
 *   - `/pattern` (anchored)  → ignore-anchored
 *   - everything else        → ignore-pattern
 */
const ignoreLanguage: languages.IMonarchLanguage = {
  ignoreCase: false,
  tokenizer: {
    root: [
      // Comments
      [/#.*$/, "ignore-comment"],

      // Negation
      [/^!\s*/, "ignore-negation", "@pattern"],

      // Anchored pattern (starts with /)
      [/^\//, "ignore-anchored", "@pattern"],

      // Directory pattern (ends with /)
      [/[^*?\s]+\/$/, "ignore-directory"],

      // Wildcards
      [/\*\*/, "ignore-wildcard"],
      [/\*/, "ignore-wildcard"],
      [/\?/, "ignore-wildcard"],

      // Regular pattern characters
      [/./, "ignore-pattern"],
    ],

    pattern: [
      // Directory pattern (ends with /)
      [/[^*?\s]+\/$/, "ignore-directory"],

      // Wildcards
      [/\*\*/, "ignore-wildcard"],
      [/\*/, "ignore-wildcard"],
      [/\?/, "ignore-wildcard"],

      // Regular pattern characters
      [/./, "ignore-pattern"],
    ],
  },
};

/**
 * Monarch definition for `.ini`, `.cfg`, `.conf` files.
 *
 * Tokenizes:
 *   - `# comment` / `; comment`  → ini-comment
 *   - `[section]`               → ini-section
 *   - `key=value`               → ini-key, ini-separator, ini-value
 *   - boolean values            → ini-boolean
 */
const iniLanguage: languages.IMonarchLanguage = {
  ignoreCase: false,
  tokenizer: {
    root: [
      // Comments
      [/#.*$/, "ini-comment"],
      [/;.*$/, "ini-comment"],

      // Section headers
      [/^\s*\[([^\]]+)\]\s*$/, "ini-section"],

      // Key = value
      [/^([^=;#\s]+?)\s*(=)\s*/, ["ini-key", "ini-separator"], "@value"],

      // Fallback
      [/.*$/, "ini-value"],
    ],

    value: [
      // Boolean values
      [/\b(true|false|yes|no|on|off|enabled|disabled)\b/i, "ini-boolean"],

      // End of value
      [/\s*$/, "", "@pop"],
      [/.*$/, "ini-value"],
    ],
  },
};

/**
 * Monarch definition for `.log` files.
 *
 * Tokenizes:
 *   - Timestamps (ISO 8601, common formats) → log-timestamp
 *   - Log levels (ERROR, WARN, INFO, DEBUG, TRACE, FATAL) → log-level-*
 *   - IP addresses → log-ip
 *   - File paths → log-path
 *   - Numbers → log-number
 *   - Quoted strings → log-string
 *   - Stack trace lines → log-stacktrace
 */
const logLanguage: languages.IMonarchLanguage = {
  ignoreCase: false,
  tokenizer: {
    root: [
      // Stack trace lines (Java-style)
      [/^\s+at\s+/, "log-stacktrace", "@stackTrace"],
      [/^Caused by:/, "log-level-error"],

      // Timestamps: ISO 8601 (2024-01-01T12:00:00.000Z)
      [
        /\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/,
        "log-timestamp",
      ],

      // Timestamps: common log format (Jan 01 12:00:00)
      [
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/,
        "log-timestamp",
      ],

      // Timestamps: HH:MM:SS
      [/\d{2}:\d{2}:\d{2}/, "log-timestamp"],

      // Log levels
      [/\b(FATAL|CRITICAL|EMERGENCY)\b/, "log-level-fatal"],
      [/\b(ERROR|ERR|SEVERE)\b/, "log-level-error"],
      [/\b(WARN|WARNING)\b/, "log-level-warn"],
      [/\b(INFO|NOTICE)\b/, "log-level-info"],
      [/\b(DEBUG|DBG)\b/, "log-level-debug"],
      [/\b(TRACE|FINE|FINER|FINEST)\b/, "log-level-trace"],

      // IP addresses (IPv4)
      [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/, "log-ip"],

      // File paths (Unix-style starting with / or ~)
      [/(?:\/|~\/)[^\s:,;]+/, "log-path"],

      // File paths (Windows-style C:\...)
      [/[A-Za-z]:\\[^\s:,;]+/, "log-path"],

      // Quoted strings
      [/"/, "log-string", "@doubleQuotedString"],
      [/'/, "log-string", "@singleQuotedString"],

      // Numbers (standalone, not part of other tokens)
      [/\b\d+\b/, "log-number"],

      // Fallback
      [/./, ""],
    ],

    stackTrace: [
      [/.*$/, "log-stacktrace", "@pop"],
    ],

    doubleQuotedString: [
      [/[^\\"]+/, "log-string"],
      [/\\./, "log-string"],
      [/"/, "log-string", "@pop"],
    ],

    singleQuotedString: [
      [/[^\\']+/, "log-string"],
      [/\\./, "log-string"],
      [/'/, "log-string", "@pop"],
    ],
  },
};

/**
 * Monarch definition for Nix expression language (.nix files).
 *
 * Tokenizes:
 *   - `# comment` / `/* block comment *&#47;`   → nix-comment
 *   - `import`, `with`, `let`, `in`, `if`, `then`, `else`, `assert`,
 *     `rec`, `inherit`, `or`                      → nix-keyword
 *   - `true`, `false`, `null`                    → nix-constant
 *   - `"string"` + interpolation `${}`          → nix-string, nix-interpolation
 *   - `'' multi-line string ''`                  → nix-string-multiline
 *   - `attr.ibute.path` or `rec { set }`        → nix-attribute
 *   - `/path/to/file`, `<nixpkgs>`               → nix-path
 *   - `123`, `0x1A`                               → nix-number
 */
const nixLanguage: languages.IMonarchLanguage = {
  ignoreCase: false,
  brackets: [
    { open: "{", close: "}", token: "delimiter.curly" },
    { open: "[", close: "]", token: "delimiter.square" },
    { open: "(", close: ")", token: "delimiter.parenthesis" },
  ],
  tokenizer: {
    root: [
      // Block comments
      [/\/\*.*?\*\//, "nix-comment"],
      [/\/\*/, "nix-comment", "@blockComment"],

      // Line comments
      [/#.*$/, "nix-comment"],

      // Paths: angle-bracket paths <nixpkgs>
      [/<[^>\s]+>/, "nix-path"],

      // Paths: /absolute or ./relative
      [/(?:\/|~\/|\.\/|\.\.\/)[^\s{}[\];,:=()"]*/, "nix-path"],

      // Numbers
      [/\b\d+(\.\d+)?([eE][+-]?\d+)?\b/, "nix-number"],
      [/\b0[xX][0-9a-fA-F]+\b/, "nix-number"],

      // Keywords
      [/\b(import|with|let|in|if|then|else|assert|rec|inherit|or|lib)\b/, "nix-keyword"],

      // Constants
      [/\b(true|false|null)\b/, "nix-constant"],

      // Multi-line strings ('' ... '')
      [/'(\\.|[^'\\])*'/, "nix-string-multiline", "@multiLineString"],

      // Double-quoted strings with interpolation
      [/"/, "nix-string", "@doubleQuotedString"],

      // URIs
      [/\b(https?|ftp|file):\/\/[^\s{}[\];,:=()"]+/, "nix-path"],

      // Attribute access: a.b.c
      [/[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+/, "nix-attribute"],

      // Identifiers
      [/[a-zA-Z_][a-zA-Z0-9_]*/, "identifier"],

      // Operators / delimiters
      [/[{}()[\]]/, "@brackets"],
      [/[;:,]/, "delimiter"],
      [/[=]/, "operator"],
    ],

    blockComment: [
      [/[^/*]+/, "nix-comment"],
      [/\*\//, "nix-comment", "@pop"],
      [/[/*]/, "nix-comment"],
    ],

    doubleQuotedString: [
      [/[^\\"$]+/, "nix-string"],
      [/\\./, "nix-string"],
      [/\$\{/, "nix-interpolation", "@interpolation"],
      [/"/, "nix-string", "@pop"],
    ],

    multiLineString: [
      [/'$/, "nix-string-multiline", "@pop"],
      [/[^']*'/, "nix-string-multiline"],
    ],

    interpolation: [
      [/[^}]+/, "nix-keyword"],
      [/\}/, "nix-interpolation", "@pop"],
    ],
  },
};

/**
 * Monarch definition for unified diff / patch files (.patch, .diff).
 *
 * Tokenizes:
 *   - `---` / `+++` file headers             → diff-file-header
 *   - `@@ -l,c +l,c @@` hunk headers         → diff-hunk-header
 *   - Lines starting with `+`                → diff-inserted
 *   - Lines starting with `-`                → diff-deleted
 *   - Lines starting with a space            → diff-context
 *   - `diff --git a/ b/` headers             → diff-command
 *   - `index`, `new file`, `deleted file`    → diff-meta
 *   - `Binary files ... differ`              → diff-binary
 */
const diffLanguage: languages.IMonarchLanguage = {
  ignoreCase: false,
  tokenizer: {
    root: [
      // diff --git a/ b/ header
      [/^diff\s+/, "diff-command", "@diffCommand"],

      // --- a/file  / +++ b/file
      [/^---\s+/, "diff-file-header", "@oldFile"],
      [/^\+\+\+\s+/, "diff-file-header", "@newFile"],

      // @@ -l,c +l,c @@ hunk header
      [/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/, "diff-hunk-header"],

      // Index line: index abc123..def456 100644
      [/^index\s+[0-9a-f]+\.\.[0-9a-f]+/, "diff-meta"],

      // new file mode / deleted file mode
      [/^(new|deleted)\s+file\s+(mode\s+\d+)?/, "diff-meta"],

      // Binary files differ
      [/^Binary\s+files\s+.*differ$/, "diff-binary"],

      // Added lines
      [/^\+.*$/, "diff-inserted"],

      // Removed lines
      [/^\-.*$/, "diff-deleted"],

      // Context lines (starting with space)
      [/^ .*$/, "diff-context"],

      // Empty lines
      [/^$/, ""],

      // Fallback
      [/.*$/, ""],
    ],

    diffCommand: [
      [/\s+/, ""],
      [/--git/, "diff-command"],
      [/a\/\S+/, "diff-file-header"],
      [/b\/\S+/, "diff-file-header"],
      [/.*$/, "", "@pop"],
    ],

    oldFile: [
      [/.*$/, "diff-file-header", "@pop"],
    ],

    newFile: [
      [/.*$/, "diff-file-header", "@pop"],
    ],
  },
};

/**
 * Registers all custom Monarch languages with Monaco.
 * Safe to call multiple times — Monaco ignores duplicate registrations.
 *
 * Call this once at app startup (or import it from a shared location).
 */
export function registerCustomLanguages(monaco: typeof import("monaco-editor")) {
  // Register language ids
  monaco.languages.register({ id: "env" });
  monaco.languages.register({ id: "properties" });
  monaco.languages.register({ id: "ignore" });
  monaco.languages.register({ id: "ini" });
  monaco.languages.register({ id: "log" });
  monaco.languages.register({ id: "nix" });
  monaco.languages.register({ id: "diff" });

  // Set Monarch tokenizers
  monaco.languages.setMonarchTokensProvider("env", envLanguage);
  monaco.languages.setMonarchTokensProvider("properties", propertiesLanguage);
  monaco.languages.setMonarchTokensProvider("ignore", ignoreLanguage);
  monaco.languages.setMonarchTokensProvider("ini", iniLanguage);
  monaco.languages.setMonarchTokensProvider("log", logLanguage);
  monaco.languages.setMonarchTokensProvider("nix", nixLanguage);
  monaco.languages.setMonarchTokensProvider("diff", diffLanguage);

  // Note: registerExtensions is not available in Monaco 0.52. The extension
  // → language mapping is handled by the EXTENSION_LANGUAGE_MAP in
  // editor.ts (languageFromPath). The Monarch provider alone is enough
  // for tokenization once the model's language is set correctly.
}
