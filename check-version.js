#!/usr/bin/env node
/**
 * Protocolo Serafim UM — checagem de versão
 *
 * Problema real que isto resolve: o próprio ecossistema Serafim teve 12+
 * cópias divergentes deste protocolo rodando sem ninguém saber qual estava
 * desatualizada (achado em auditoria de 2026-09-11/2026-10-07). Este script
 * compara a versão instalada contra a publicada e avisa — não deixa a
 * deriva de versão acontecer em silêncio de novo.
 *
 * Uso:
 *   node check-version.js
 *   npx protocolo-serafim-um-setup --check   (atalho equivalente)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const VERSION_URL = 'https://raw.githubusercontent.com/SerafimWeb/protocolo-serafim-um/main/VERSION';
const PRODUCT_URL = 'https://serafimweb.com/serafim13/protocolo-um';

function readLocalVersion() {
  const local = path.join(__dirname, 'VERSION');
  try {
    return fs.readFileSync(local, 'utf8').trim();
  } catch {
    return null;
  }
}

function fetchRemoteVersion() {
  return new Promise((resolve, reject) => {
    const req = https.get(VERSION_URL, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data.trim()));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function main() {
  const local = readLocalVersion();
  if (!local) {
    console.log('Não achei um arquivo VERSION local — rode este script de dentro do pacote instalado.');
    process.exit(1);
  }

  console.log(`Versão instalada: ${local}`);

  let remote;
  try {
    remote = await fetchRemoteVersion();
  } catch (err) {
    console.log(`Não foi possível verificar a versão publicada agora (${err.message}). Tente de novo mais tarde.`);
    process.exit(0); // falha de rede não é erro do protocolo — não quebra o fluxo de quem chama
  }

  if (remote === local) {
    console.log('Você está na versão mais recente.');
    return;
  }

  console.log(`Nova versão disponível: ${remote} (você está em ${local}).`);
  console.log(`Changelog e upgrade: ${PRODUCT_URL}`);
}

main();
