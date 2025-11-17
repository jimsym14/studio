#!/usr/bin/env node
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';

const PREFERRED_PORT = Number(process.env.PORT ?? process.env.DEV_PORT ?? 9002);
const HOST = '0.0.0.0';
const MAX_PORT_TRIES = 50;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once('error', () => {
      tester.close();
      resolve(false);
    });

    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });

    tester.listen(port, HOST);
  });
}

async function findAvailablePort(startPort) {
  let port = startPort;
  let attempts = 0;

  while (!(await isPortAvailable(port))) {
    attempts += 1;

    if (attempts >= MAX_PORT_TRIES) {
      throw new Error(
        `Unable to find an open port after trying ${MAX_PORT_TRIES} consecutive ports starting at ${startPort}.`
      );
    }

    port += 1;
  }

  return port;
}

async function main() {
  const port = await findAvailablePort(PREFERRED_PORT);

  if (port !== PREFERRED_PORT) {
    console.log(
      `⚠️  Port ${PREFERRED_PORT} is busy. Starting Next.js dev server on ${port} instead.`
    );
  }

  const extraArgs = process.argv.slice(2);
  const nextArgs = ['dev', '--turbopack', '-p', String(port), ...extraArgs];
  const nextBinary = path.resolve(
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'next.cmd' : 'next'
  );

  const child = spawn(nextBinary, nextArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(port)
    },
    shell: process.platform === 'win32'
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('Failed to start Next.js dev server:', error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
