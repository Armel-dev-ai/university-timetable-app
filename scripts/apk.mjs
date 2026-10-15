import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = process.argv[2] === 'release';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function javaVersion(javaHome) {
  const java = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!existsSync(java)) return 0;
  const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const version = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.match(/version "(?:1\.)?(\d+)/);
  return version ? Number(version[1]) : 0;
}

function candidateHomes() {
  if (process.platform !== 'win32') return [];
  const roots = [
    process.env.ProgramFiles,
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Android\\Android Studio\\jbr',
  ].filter(Boolean);
  return roots.flatMap((rootPath) => {
    if (existsSync(path.join(rootPath, 'bin', 'java.exe'))) return [rootPath];
    try {
      return readdirSync(rootPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(rootPath, entry.name));
    } catch {
      return [];
    }
  });
}

function getJavaHome() {
  const configured = process.env.JAVA_HOME;
  const configuredVersion = configured ? javaVersion(configured) : 0;
  if (configuredVersion >= 17 && configuredVersion <= 22) return configured;
  if (process.platform !== 'win32') return configured;
  const available = candidateHomes()
    .map((home) => ({ home, version: javaVersion(home) }))
    .filter(({ version }) => version >= 17 && version <= 22)
    .sort((a, b) => a.version - b.version)[0];
  if (available) return available.home;
  throw new Error('JDK 17 à 22 introuvable. Configurez JAVA_HOME avant le build Android.');
}

try {
  run('npm', ['run', 'build']);
  run('npx', ['cap', 'sync', 'android']);
  const javaHome = getJavaHome();
  const env = {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
  };
  const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  run(wrapper, ['assemble' + (release ? 'Release' : 'Debug')], {
    cwd: path.join(root, 'android'),
    env,
  });
  const variant = release ? 'release' : 'debug';
  const artifact = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
  const destination = path.join(root, `app-${variant}.apk`);
  if (!existsSync(artifact)) throw new Error(`APK introuvable après compilation : ${artifact}`);
  copyFileSync(artifact, destination);
  process.stdout.write(`APK prêt : ${destination}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
