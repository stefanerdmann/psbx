#!/usr/bin/env node
/**
 * `psbx` CLI entry point. Wires every command in `src/commands/` into
 * a `commander` program, handles the global `-y, --yes` flag (forwarded to
 * `confirm()` via `setGlobalYes`), and enables positional/pass-through
 * options on `up` and `exec` so that everything after `--` is forwarded
 * verbatim to `limactl` / the in-VM command.
 */

import { Command } from 'commander';
import {
  DELETE_DESCRIPTION as CACHE_DELETE_DESCRIPTION,
  DESCRIPTION as CACHE_DESCRIPTION,
  LIST_DESCRIPTION as CACHE_LIST_DESCRIPTION,
  STATUS_DESCRIPTION as CACHE_STATUS_DESCRIPTION,
  cacheStatus,
  deleteCacheCommand,
  listCaches,
} from '../src/commands/cache.ts';
import {
  DESCRIPTION as COMPLETION_DESCRIPTION,
  HELP_TEXT as COMPLETION_HELP_TEXT,
  completion,
} from '../src/commands/completion.ts';
import {
  DESCRIPTION as DELETE_DESCRIPTION,
  HELP_TEXT as DELETE_HELP_TEXT,
  del,
} from '../src/commands/delete.ts';
import {
  DESCRIPTION as DELETE_PROFILE_DESCRIPTION,
  deleteProfile,
} from '../src/commands/delete-profile.ts';
import {
  DESCRIPTION as EDIT_PROFILE_DESCRIPTION,
  editProfile,
} from '../src/commands/edit-profile.ts';
import { DESCRIPTION as EXEC_DESCRIPTION, exec } from '../src/commands/exec.ts';
import { setGlobalYes } from '../src/commands/helpers.ts';
import {
  DESCRIPTION as INIT_DESCRIPTION,
  HELP_TEXT as INIT_HELP_TEXT,
  init,
} from '../src/commands/init.ts';
import { DESCRIPTION as LIST_DESCRIPTION, list } from '../src/commands/list.ts';
import {
  DESCRIPTION as LIST_PROFILES_DESCRIPTION,
  listProfiles,
} from '../src/commands/list-profile.ts';
import { DESCRIPTION as LOGS_DESCRIPTION, logs } from '../src/commands/logs.ts';
import {
  DESCRIPTION as PROFILE_FORK_DESCRIPTION,
  profileFork,
} from '../src/commands/profile-fork.ts';
import {
  DESCRIPTION as RENAME_PROFILE_DESCRIPTION,
  renameProfile,
} from '../src/commands/rename-profile.ts';
import { DESCRIPTION as RESTART_DESCRIPTION, restart } from '../src/commands/restart.ts';
import {
  DESCRIPTION as SET_DEFAULT_DESCRIPTION,
  setDefault,
} from '../src/commands/set-default-profile.ts';
import {
  DESCRIPTION as STATUS_DESCRIPTION,
  HELP_TEXT as STATUS_HELP_TEXT,
  status,
} from '../src/commands/status.ts';
import { DESCRIPTION as STOP_DESCRIPTION, stop } from '../src/commands/stop.ts';
import {
  DESCRIPTION as UP_DESCRIPTION,
  HELP_TEXT as UP_HELP_TEXT,
  up,
} from '../src/commands/up.ts';

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
  .description(UP_DESCRIPTION)
  .addHelpText('after', `\n${UP_HELP_TEXT}`)
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
  .description(STOP_DESCRIPTION)
  .option('-f, --force', 'Force stop without graceful shutdown')
  .action((options: StopOptions): Promise<void> => stop(options));

program
  .command('restart')
  .description(RESTART_DESCRIPTION)
  .option('-f, --force', 'Force stop without graceful shutdown')
  .action((options: StopOptions): Promise<void> => restart(options));

program
  .command('exec')
  .description(EXEC_DESCRIPTION)
  .option('--shell', 'Open a plain shell instead of running a command')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .passThroughOptions()
  .argument('[cmd...]', 'Command to run inside the sandbox, preferably after --')
  .action((cmd: string[], options: ExecOptions): Promise<void> => exec(cmd, options));

program
  .command('delete')
  .description(DELETE_DESCRIPTION)
  .addHelpText('after', `\n${DELETE_HELP_TEXT}`)
  .argument('[vm-name]', 'Name of the VM to delete (defaults to current project VM)')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--all-registered', 'Delete all registered VMs')
  .action(
    (vmName: string | undefined, options: DeleteOptions): Promise<void> => del(vmName, options),
  );

const cacheCmd = program.command('cache').description(CACHE_DESCRIPTION);

cacheCmd
  .command('list')
  .alias('ls')
  .description(CACHE_LIST_DESCRIPTION)
  .action((): Promise<void> => listCaches());

cacheCmd
  .command('status')
  .description(CACHE_STATUS_DESCRIPTION)
  .option(
    '-p, --profile <name>',
    'Use a specific profile instead of the current project registry/default',
  )
  .action((options: CacheOptions): Promise<void> => cacheStatus(options));

cacheCmd
  .command('delete')
  .description(CACHE_DELETE_DESCRIPTION)
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
  .description('Manage profiles (init, delete, list, edit, rename, set-default)');

profileCmd
  .command('init <profile>')
  .description(INIT_DESCRIPTION)
  .addHelpText('after', `\n${INIT_HELP_TEXT}`)
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
  .description(PROFILE_FORK_DESCRIPTION)
  .action((newProfile: string): Promise<void> => profileFork(newProfile));

profileCmd
  .command('rename <src> <dest>')
  .description(RENAME_PROFILE_DESCRIPTION)
  .option('-f, --force', 'Overwrite destination profile if it exists')
  .action(
    (src: string, dest: string, options: { force?: boolean }): Promise<void> =>
      renameProfile(src, dest, options),
  );

profileCmd
  .command('delete')
  .description(DELETE_PROFILE_DESCRIPTION)
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
  .description(LIST_PROFILES_DESCRIPTION)
  .option('--plain', 'Output bare profile names (no markers or messages)')
  .action((options: ListProfilesOptions): Promise<void> => listProfiles(options));

profileCmd
  .command('set-default <name>')
  .description(SET_DEFAULT_DESCRIPTION)
  .action((name: string): Promise<void> => setDefault(name));

profileCmd
  .command('edit [profile]')
  .description(EDIT_PROFILE_DESCRIPTION)
  .option('--file <file>', 'Open a specific file (lima, env, or path relative to profile)')
  .action(
    (profile: string | undefined, options: EditProfileOptions): Promise<void> =>
      editProfile(profile, options),
  );

// --- remaining top-level commands -------------------------------------------

program
  .command('status')
  .description(STATUS_DESCRIPTION)
  .addHelpText('after', `\n${STATUS_HELP_TEXT}`)
  .option('--json', 'Output as JSON')
  .action((opts: StatusOptions): Promise<void> => status(opts));

program
  .command('list')
  .alias('ls')
  .description(LIST_DESCRIPTION)
  .option('--prune', 'Remove stale entries (VM and project dir both gone)')
  .action((options: ListOptions): Promise<void> => list(options));

program
  .command('completion [shell]')
  .description(COMPLETION_DESCRIPTION)
  .addHelpText('after', `\n${COMPLETION_HELP_TEXT}`)
  .action((shell: string | undefined): Promise<void> => completion(shell));

program
  .command('logs')
  .description(LOGS_DESCRIPTION)
  .action((): Promise<void> => logs());

program.parse();
