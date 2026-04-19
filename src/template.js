import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';

// ---------------------------------------------------------------------------
// Template directory resolution.
// Uses import.meta.url so templates are found relative to this package,
// not relative to the user's cwd. Works with both `npm link` and
// `npm install -g`.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');

// ---------------------------------------------------------------------------
// Compiled template cache.
// Templates are loaded and compiled on first use, then cached.
// ---------------------------------------------------------------------------

const compiledTemplates = {};

function getTemplate(name) {
  if (!compiledTemplates[name]) {
    const templatePath = resolve(TEMPLATES_DIR, name);
    const source = readFileSync(templatePath, 'utf-8');
    compiledTemplates[name] = Handlebars.compile(source, { noEscape: true });
  }
  return compiledTemplates[name];
}

// ---------------------------------------------------------------------------
// Indent a multi-line string by a given number of spaces.
// Used to embed rendered provisioning scripts into the YAML block scalar
// with correct indentation.
// ---------------------------------------------------------------------------

function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map(line => (line.length > 0 ? pad + line : line))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Build the complete Lima YAML from Handlebars templates.
//
// Rendering order:
//   1. provision-system.sh.hbs  → system provisioning script
//   2. provision-user.sh.hbs    → user provisioning script
//   3. lima.yaml.hbs            → final YAML (receives rendered scripts)
//
// The public API (buildLimaYaml, writeLimaYaml) stays the same as before.
// Callers (create.js, recreate.js) don't need any changes.
//
// Args:
//   profile    — resolved profile object from config.resolveProfile()
//   projectDir — absolute path to the project directory on the host
// ---------------------------------------------------------------------------

export function buildLimaYaml(profile, projectDir) {
  // Prepare cert context — null if no cert configured
  const cert = profile.cert?.hostBundlePath
    ? {
        dir: dirname(profile.cert.hostBundlePath),
        fileName: basename(profile.cert.hostBundlePath)
      }
    : null;

  // Render provisioning scripts
  const systemTemplate = getTemplate('provision-system.sh.hbs');
  const userTemplate = getTemplate('provision-user.sh.hbs');

  const systemScript = systemTemplate({ cert });
  const userScript = userTemplate({ cert });

  // Indent scripts for YAML block scalar embedding (6 spaces = under provision.script)
  const systemProvision = indent(systemScript, 6);
  const userProvision = indent(userScript, 6);

  // Render final Lima YAML
  const limaTemplate = getTemplate('lima.yaml.hbs');
  const yaml = limaTemplate({
    vm: profile.vm,
    pi: { configDir: profile.pi.configDir },
    projectDir,
    cert,
    systemProvision,
    userProvision
  });

  return yaml;
}

// ---------------------------------------------------------------------------
// Write the Lima YAML to a file.
// Used by the create command to write a temp file before calling limactl.
// ---------------------------------------------------------------------------

export function writeLimaYaml(profile, projectDir, outputPath) {
  const yamlContent = buildLimaYaml(profile, projectDir);
  writeFileSync(outputPath, yamlContent, 'utf-8');
  return outputPath;
}
