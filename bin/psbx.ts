#!/usr/bin/env node
/**
 * `psbx` CLI entry point. Wires every command in `src/commands/` into
 * a `commander` program, handles the global `-y, --yes` flag (forwarded to
 * `confirm()` via `setGlobalYes`), and enables positional/pass-through
 * options on `up` and `exec` so that everything after `--` is forwarded
 * verbatim to `limactl` / the in-VM command.
 */

import { Command } from 'commander';
import { cacheStatus, deleteCacheCommand, listCaches } from '../src/commands/cache.ts';
import { completion } from '../src/commands/completion.ts';
import { del } from '../src/commands/delete.ts';
import { deleteProfile } from '../src/commands/delete-profile.ts';
import { editProfile } from '../src/commands/edit-profile.ts';
import { exec } from '../src/commands/exec.ts';
import { setGlobalYes } from '../src/commands/helpers.ts';
import { init } from '../src/commands/init.ts';
import { list } from '../src/commands/list.ts';
import { listProfiles } from '../src/commands/list-profile.ts';
import { logs } from '../src/commands/logs.ts';
import { profileFork } from '../src/commands/profile-fork.ts';
import { restart } from '../src/commands/restart.ts';
import { setDefault } from '../src/commands/set-default-profile.ts';
import { status } from '../src/commands/status.ts';
import { stop } from '../src/commands/stop.ts';
import { up } from '../src/commands/up.ts';

interface GlobalOptions {
  yes?: boolean;
}

interface UpOptions {
  profile?: string;
  shell?: boolean;
  onlyCreate?: boolean;
  onlyRecreate?: boolean;
  onlyStart?: boolean;
  forceRecreate?: boolean;
}

interface StopOptions {
  force?: boolean;
}

interface ExecOptions {
  shell?: boolean;
}

interface DeleteOptions {
  force?: boolean;
  allRegistered?: boolean;
}

interface CacheOptions {
  profile?: string;
  force?: boolean;
  all?: boolean;
}

interface InitOptions {
  fromProfile?: string;
  template?: string;
  selfTest?: boolean;
  copyFromHost?: boolean;
  symlinkFromHost?: boolean;
  setAsDefault?: boolean;
}

interface ListProfilesOptions {
  plain?: boolean;
}

interface EditProfileOptions {
  file?: string;
}

interface StatusOptions {
  json?: boolean;
}

interface ListOptions {
  prune?: boolean;
}

const program = new Command();
program.enablePositionalOptions();

program
  .name('psbx')
  .description(
    'Manage Lima VMs per working directory for project-isolated agentic coding.\n\n' +
      'State directory: ~/.psbx (override with PSBX_HOME)',
  )
  .version('0.2.0')
  .option('-y, --yes', 'Skip confirmation prompts')
  .hook('preAction', (thisCommand: Command): void => {
    setGlobalYes(thisCommand.opts<GlobalOptions>().yes);
  });

program
  .command('up')
  .description('Bring sandbox up: create, start, and enter in one step')
  .option('-p, --profile <name>', 'Use a specific profile')
  .option('--shell', 'Open a plain shell instead of running the default command')
  .option('--only-create', 'Only create the VM (fail if it already exists)')
  .option('--only-recreate', 'Only recreate the VM (fail if it does not exist)')
  .option('--only-start', 'Only start the VM (fail if it does not exist)')
  .option('--force-recreate', 'Recreate the VM if it exists, create it otherwise')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .passThroughOptions()
  .argument('[limactlArgs...]', 'Extra limactl create arguments, preferably after --')
  .action(
    (limactlArgs: string[], options: UpOptions): Promise<void> => up({ ...options, limactlArgs }),
  );

program
  .command('stop')
  .description('Stop a running VM')
  .option('-f, --force', 'Force stop without graceful shutdown')
  .action((options: StopOptions): Promise<void> => stop(options));

program
  .command('restart')
  .description('Stop and then start the VM (without re-entering the shell)')
  .option('-f, --force', 'Force stop without graceful shutdown')
  .action((options: StopOptions): Promise<void> => restart(options));

program
  .command('exec')
  .description('Run a one-off command in the sandbox (auto-starts if stopped)')
  .option('--shell', 'Open a plain shell instead of running a command')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .passThroughOptions()
  .argument('[cmd...]', 'Command to run inside the sandbox, preferably after --')
  .action((cmd: string[], options: ExecOptions): Promise<void> => exec(cmd, options));

program
  .command('delete')
  .description('Delete a VM (with confirmation)')
  .argument('[vm-name]', 'Name of the VM to delete (defaults to current project VM)')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--all-registered', 'Delete all registered VMs')
  .action(
    (vmName: string | undefined, options: DeleteOptions): Promise<void> => del(vmName, options),
  );

const cacheCmd = program
  .command('cache')
  .description('Manage hidden profile caches (list, status, delete)');

cacheCmd
  .command('list')
  .alias('ls')
  .description('List all profile caches')
  .action((): Promise<void> => listCaches());

cacheCmd
  .command('status')
  .description('Show whether the current project already has a matching profile cache')
  .option(
    '-p, --profile <name>',
    'Use a specific profile instead of the current project registry/default',
  )
  .action((options: CacheOptions): Promise<void> => cacheStatus(options));

cacheCmd
  .command('delete')
  .description('Delete the matching profile cache for the current project')
  .option(
    '-p, --profile <name>',
    'Use a specific profile instead of the current project registry/default',
  )
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--all', 'Delete all profile caches')
  .action((options: CacheOptions): Promise<void> => deleteCacheCommand(options));

// --- profile subcommand namespace -------------------------------------------
const profileCmd = program
  .command('profile')
  .description('Manage profiles (init, delete, list, edit, set-default)');

profileCmd
  .command('init <profile>')
  .description('Initialize a psbx profile')
  .option('--from-profile <name>', 'Copy an existing profile')
  .option(
    '--template <name>',
    'Use a shipped profile template (pi-in-ubuntu, self-test, copilot-in-ubuntu); defaults to pi-in-ubuntu',
  )
  .option('--self-test', 'Use the lightweight self-test profile template')
  .option('--copy-from-host', 'Copy ~/.pi/agent into the new profile')
  .option('--symlink-from-host', 'Symlink ~/.pi/agent into the new profile')
  .option('--set-as-default', 'Set this profile as the default')
  .action((profile: string, options: InitOptions): Promise<void> => init(profile, options));

profileCmd
  .command('fork <new-profile>')
  .description(
    "Snapshot the current project VM's profile (plus exfiltrated guest config) into a new profile and rebase the VM onto it",
  )
  .action((newProfile: string): Promise<void> => profileFork(newProfile));

profileCmd
  .command('delete')
  .description('Delete a profile')
  .argument('[name]', 'Profile name to delete')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--all', 'Delete all profiles')
  .action(
    (name: string | undefined, options: DeleteOptions): Promise<void> =>
      deleteProfile(name, options),
  );

profileCmd
  .command('list')
  .alias('ls')
  .description('List all profiles')
  .option('--plain', 'Output bare profile names (no markers or messages)')
  .action((options: ListProfilesOptions): Promise<void> => listProfiles(options));

profileCmd
  .command('set-default <name>')
  .description('Set the default profile')
  .action((name: string): Promise<void> => setDefault(name));

profileCmd
  .command('edit [profile]')
  .description('Open a profile in $EDITOR')
  .option('--file <file>', 'Open a specific file (lima, env, or path relative to profile)')
  .action(
    (profile: string | undefined, options: EditProfileOptions): Promise<void> =>
      editProfile(profile, options),
  );

// --- remaining top-level commands -------------------------------------------

program
  .command('status')
  .description('Show VM status, environment, and sync state for the current project')
  .option('--json', 'Output as JSON')
  .action((opts: StatusOptions): Promise<void> => status(opts));

program
  .command('list')
  .alias('ls')
  .description('List all psbx VMs')
  .option('--prune', 'Remove stale entries (VM and project dir both gone)')
  .action((options: ListOptions): Promise<void> => list(options));

program
  .command('completion [shell]')
  .description('Generate shell completion scripts (bash, zsh, fish)')
  .addHelpText(
    'after',
    '\n' +
      'Auto-detects shell from $SHELL when no argument given.\n\n' +
      '  bash:   eval "$(psbx completion bash)"   # add to ~/.bashrc\n' +
      '  zsh:    mkdir -p ~/.local/share/zsh/completions/completions && psbx completion zsh > ~/.local/share/zsh/completions/_psbx\n' +
      '          # and add to ~/.zshrc (before compinit): fpath+=(~/.local/share/zsh/completions/completions)\n' +
      '          # alternatively (after compinit): eval "$(psbx completion zsh)"\n' +
      '  fish:   psbx completion fish > ~/.config/fish/completions/psbx.fish',
  )
  .action((shell: string | undefined): Promise<void> => completion(shell));

program
  .command('logs')
  .description('Show cloud-init provisioning logs for the project VM and its profile cache VM')
  .action((): Promise<void> => logs());

program.parse();
