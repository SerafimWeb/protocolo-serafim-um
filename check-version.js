#!/usr/bin/env node
/**
 * Protocolo Serafim UM — checagem de versão
 *
 * Problema real que isto resolve: o próprio ecossistema Serafim teve 12+
 * cópias divergentes deste protocolo rodando sem ninguém saber qual estava
 * desatualizada. Este script compara a versão instalada contra a publicada
 * no npm e avisa — não deixa a deriva de versão acontecer em silêncio.
 *
 * Uso:
 *   npx protocolo-serafim-um-setup --check
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const REGISTRY_URL = 'https://registry.npmjs.org/protocolo-serafim-um-setup/latest';
const PRODUCT_URL = 'https://serafimweb.com/serafim13/protocolo-um';

function readLocal() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const methodology = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();
    return { version: pkg.version, methodology };
  } catch {
    return null;
  }
}

function fetchLatest() {
  return new Promise((resolve, reject) => {
    const req = https.get(REGISTRY_URL, { timeout: 5000, headers: { Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data).version); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

// "1.10.0" > "1.9.0" — comparação numérica por parte, não de texto.
function isNewer(remote, local) {
  const r = String(remote).split('.').map(Number);
  const l = String(local).split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const diff = (r[i] || 0) - (l[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

async function main() {
  const local = readLocal();
  if (!local) {
    console.log('Não achei a versão instalada — rode de dentro do pacote (npx protocolo-serafim-um-setup --check).');
    process.exitCode = 1;
    return;
  }
  console.log(`Instalador: ${local.version} · Metodologia: v${local.methodology}`);

  let latest;
  try {
    latest = await fetchLatest();
  } catch (err) {
    console.log(`Não foi possível consultar o npm agora (${err instanceof Error ? err.message : err}). Tente mais tarde.`);
    return; // falha de rede não é erro do protocolo
  }

  if (!isNewer(latest, local.version)) {
    console.log('Você está na versão mais recente.');
    return;
  }
  console.log(`Nova versão disponível: ${latest}. Atualize rodando de novo: npx protocolo-serafim-um-setup@latest`);
  console.log(`(sua memória e seu CLAUDE.md não são apagados). Novidades: ${PRODUCT_URL}`);
}

main();
