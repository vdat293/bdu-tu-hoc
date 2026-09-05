import fs from 'node:fs/promises';
import path from 'node:path';

const files = ['public/css/style.css', 'public/css/login.css', 'public/css/showcase.css', 'public/css/admin-tool.css'];
const tokenPattern = /(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\((?:[^()]|\([^)]*\))*\))/g;

function minifyCss(source) {
  const tokens = [];
  let css = source.replace(tokenPattern, token => {
    const id = `___BDU_CSS_TOKEN_${tokens.length}___`;
    tokens.push(token);
    return id;
  });
  css = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
  return css.replace(/___BDU_CSS_TOKEN_(\d+)___/g, (_, index) => tokens[Number(index)]);
}

for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  const minified = minifyCss(source);
  const output = file.replace(/\.css$/i, '.min.css');
  await fs.writeFile(output, `${minified}\n`, 'utf8');
  console.log(`${path.basename(file)}: ${source.length} -> ${minified.length} bytes`);
}
