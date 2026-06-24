#!/usr/bin/env node
'use strict';

// Wrap prose inside block scalars in the dist/ specs to 120 columns.

const fs = require('node:fs');
const path = require('node:path');
const { findLatestSpecs } = require('../tests/helpers');

const WIDTH = 120;
const repoRoot = path.join(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

// Collect every *-openapi.yaml under a directory, recursively.
function findOpenApiFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findOpenApiFiles(fullPath, files);
    } else if (entry.name.endsWith('-openapi.yaml')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Pick the file's dominant line ending so we don't flip every line.
function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf >= lf ? '\r\n' : '\n';
}

// Match a block scalar opener; captures indent (m[1]) and indicators (m[3]).
const BLOCK_OPENER = /^(\s*)(?:[^:#\s][^:]*:|-)\s*([>|])([-+0-9]*)\s*(?:#.*)?$/;

// Return a line's leading whitespace.
function leadingWhitespace(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : '';
}

// True for blank lines and markdown structure (bullets, lists, headings, etc.).
function isUnwrappable(content) {
  const trimmed = content.trimStart();
  if (trimmed === '') return true;
  if (/^([*+]\s|-\s|\d+[.)]\s|#|>|\|)/.test(trimmed)) return true;
  return false;
}

// Greedily wrap `content` to the budget, re-indenting every produced line.
function wrapContent(indent, content) {
  const words = content.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [indent + content];
  const out = [];
  let current = indent + words[0];
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if (current.length + 1 + word.length > WIDTH) {
      out.push(current);
      current = indent + word;
    } else {
      current += ' ' + word;
    }
  }
  out.push(current);
  return out;
}

function formatText(text) {
  const eol = detectEol(text);
  const lines = text.split(/\r\n|\n/);
  const out = [];

  // Block scalar state.
  let inBlock = false;     // inside a block scalar
  let inFence = false;     // inside a ``` / ~~~ fenced code block
  let skipBlock = false;   // block has an explicit indent indicator — leave verbatim
  let openerIndent = 0;    // indent of the opener line
  let baseIndent = null;   // indent of the first content line

  // Buffer of consecutive wrappable lines.
  let para = [];

  // Flush the buffered paragraph, re-wrapping it only if a line is too long.
  function flushPara() {
    if (para.length === 0) return;
    const needsReflow = para.some(l => l.length > WIDTH);
    if (needsReflow) {
      const indentStr = para[0].slice(0, baseIndent);
      const joined = para.map(l => l.slice(baseIndent)).join(' ');
      for (const wrapped of wrapContent(indentStr, joined)) out.push(wrapped);
    } else {
      for (const l of para) out.push(l);
    }
    para = [];
  }

  for (const line of lines) {
    if (inBlock) {
      const trimmedEnd = line.replace(/\s+$/, '');
      if (trimmedEnd === '') {
        // Blank line — end the paragraph, keep the blank.
        flushPara();
        out.push(line);
        continue;
      }
      const indent = leadingWhitespace(line).length;
      if (indent <= openerIndent) {
        // Dedented out of the block — reset and re-handle below.
        flushPara();
        inBlock = false;
        inFence = false;
        skipBlock = false;
        baseIndent = null;
      } else if (skipBlock) {
        out.push(line);
        continue;
      } else {
        if (baseIndent === null) baseIndent = indent;
        const content = line.slice(baseIndent);
        // Toggle fenced code blocks and pass them through untouched.
        if (/^(```|~~~)/.test(content.trimStart())) {
          flushPara();
          out.push(line);
          inFence = !inFence;
          continue;
        }
        if (inFence) {
          out.push(line);
          continue;
        }
        // Buffer plain prose at the base indent; emit anything else verbatim.
        if (indent === baseIndent && !isUnwrappable(content) && !/ {2,}$/.test(line)) {
          para.push(line);
        } else {
          flushPara();
          out.push(line);
        }
        continue;
      }
    }

    // Outside a block — open one if this line is a block scalar opener.
    const m = line.match(BLOCK_OPENER);
    if (m) {
      inBlock = true;
      inFence = false;
      skipBlock = /\d/.test(m[3]);
      openerIndent = m[1].length;
      baseIndent = null;
    }
    out.push(line);
  }
  flushPara();

  return out.join(eol);
}

// Resolve target files: latest specs by default, `--all` for every spec, or explicit paths.
function gatherFiles(args, all) {
  if (args.length === 0) return all ? findOpenApiFiles(distDir) : findLatestSpecs();
  const files = [];
  for (const arg of args) {
    const full = path.resolve(arg);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) findOpenApiFiles(full, files);
    else files.push(full);
  }
  return files;
}

// CLI: format files in place, or report unformatted ones with `--check`.
function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const all = argv.includes('--all');
  const files = gatherFiles(argv.filter(a => !a.startsWith('--')), all);

  const changed = [];
  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    const formatted = formatText(original);
    if (formatted !== original) {
      changed.push(file);
      if (!checkOnly) fs.writeFileSync(file, formatted);
    }
  }

  if (checkOnly) {
    if (changed.length > 0) {
      console.error(`${changed.length} file(s) need formatting:`);
      for (const f of changed) console.error('  ' + path.relative(repoRoot, f));
      console.error('\nRun `npm run format` to fix.');
      process.exit(1);
    }
    console.log(`All ${files.length} spec file(s) already formatted.`);
    return;
  }

  if (changed.length > 0) {
    console.log(`Formatted ${changed.length} file(s):`);
    for (const f of changed) console.log('  ' + path.relative(repoRoot, f));
  } else {
    console.log(`No changes — all ${files.length} spec file(s) already formatted.`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { formatText, detectEol };
