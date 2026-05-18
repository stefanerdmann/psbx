/**
 * The completion scripts are hand-maintained string constants rather than
 * being generated from commander's metadata: commander's auto-generated
 * completions don't cover nested subcommands (cache/profile) or shell out
 * to `psbx profile list --plain` for dynamic profile-name completion.
 */

export const DESCRIPTION = 'Generate shell completion scripts (bash, zsh, fish)';

export const HELP_TEXT =
  'Auto-detects shell from $SHELL when no argument given.\n\n' +
  '  bash:   eval "$(psbx completion bash)"   # add to ~/.bashrc\n' +
  '  zsh:    mkdir -p ~/.local/share/zsh/completions/completions && psbx completion zsh > ~/.local/share/zsh/completions/_psbx\n' +
  '          # and add to ~/.zshrc (before compinit): fpath+=(~/.local/share/zsh/completions/completions)\n' +
  '          # alternatively (after compinit): eval "$(psbx completion zsh)"\n' +
  '  fish:   psbx completion fish > ~/.config/fish/completions/psbx.fish';

import { handleError } from './helpers.ts';

const BASH_COMPLETION = `# psbx bash completion
#
# Installation:
#
#     echo 'eval "$(psbx completion bash)"' >> ~/.bashrc

_psbx_profiles() {
  psbx profile list --plain 2>/dev/null
}

_psbx() {
  local cur prev commands profile_commands cache_commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="up exec stop restart delete cache profile status list ls logs completion"
  profile_commands="init fork delete list ls set-default edit"
  cache_commands="list ls status delete"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  # Handle cache subcommands
  if [[ "\${COMP_WORDS[1]}" == "cache" ]]; then
    if [[ \${COMP_CWORD} -eq 2 ]]; then
      COMPREPLY=( $(compgen -W "\${cache_commands}" -- "\${cur}") )
      return 0
    fi
    case "\${COMP_WORDS[2]}" in
      delete)
        COMPREPLY=( $(compgen -W "--profile --force --all" -- "\${cur}") )
        ;;
      status)
        COMPREPLY=( $(compgen -W "--profile" -- "\${cur}") )
        ;;
    esac
    return 0
  fi

  # Handle profile subcommands
  if [[ "\${COMP_WORDS[1]}" == "profile" ]]; then
    if [[ \${COMP_CWORD} -eq 2 ]]; then
      COMPREPLY=( $(compgen -W "\${profile_commands}" -- "\${cur}") )
      return 0
    fi
    case "\${COMP_WORDS[2]}" in
      init)
        COMPREPLY=( $(compgen -W "--from-profile --template --self-test --copy-from-host --symlink-from-host --set-as-default" -- "\${cur}") )
        ;;
      delete)
        COMPREPLY=( $(compgen -W "--force --all $(_psbx_profiles)" -- "\${cur}") )
        ;;
      set-default)
        COMPREPLY=( $(compgen -W "$(_psbx_profiles)" -- "\${cur}") )
        ;;
      edit)
        COMPREPLY=( $(compgen -W "--file $(_psbx_profiles)" -- "\${cur}") )
        ;;
    esac
    case "\${prev}" in
      --from-profile)
        COMPREPLY=( $(compgen -W "$(_psbx_profiles)" -- "\${cur}") )
        ;;
      --template)
        COMPREPLY=( $(compgen -W "pi-in-ubuntu self-test copilot-in-ubuntu" -- "\${cur}") )
        ;;
    esac
    return 0
  fi

  case "\${prev}" in
    up)
      COMPREPLY=( $(compgen -W "--profile --shell --only-create --only-recreate --only-start --force-recreate" -- "\${cur}") )
      ;;
    exec)
      COMPREPLY=( $(compgen -W "--shell" -- "\${cur}") )
      ;;
    --profile|--from-profile)
      COMPREPLY=( $(compgen -W "$(_psbx_profiles)" -- "\${cur}") )
      ;;
    stop)
      COMPREPLY=( $(compgen -W "--force" -- "\${cur}") )
      ;;
    restart)
      COMPREPLY=( $(compgen -W "--force" -- "\${cur}") )
      ;;
    delete)
      COMPREPLY=( $(compgen -W "--force --all-registered" -- "\${cur}") )
      ;;
    status)
      COMPREPLY=( $(compgen -W "--json" -- "\${cur}") )
      ;;
    --template)
      COMPREPLY=( $(compgen -W "pi-in-ubuntu self-test copilot-in-ubuntu" -- "\${cur}") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      ;;
  esac
}
complete -F _psbx psbx
`;

const ZSH_COMPLETION = `#compdef psbx
# psbx zsh completion
#
# Installation:
#
#   Option 1 – file in $fpath (recommended):
#     mkdir -p ~/.local/share/zsh/completions/completions
#     psbx completion zsh > ~/.local/share/zsh/completions/completions/_psbx
#     # and add to ~/.zshrc BEFORE the compinit call:
#     #   fpath+=(~/.local/share/zsh/completions/completions)
#     #   autoload -Uz compinit && compinit
#
#   Option 2 – eval in ~/.zshrc (add AFTER compinit):
#     eval "$(psbx completion zsh)"

_psbx_profiles() {
  local -a profiles
  profiles=(\${(f)"$(psbx profile list --plain 2>/dev/null)"})
  _describe -t profiles 'profile' profiles
}

_psbx_profile_commands() {
  local -a profile_cmds
  profile_cmds=(
    'init:Initialize a psbx profile'
    'fork:Snapshot the current project VM into a new profile and rebase the VM onto it'
    'delete:Delete a profile'
    'list:List all profiles'
    'ls:List all profiles'
    'set-default:Set the default profile'
    'edit:Open a profile in \\$EDITOR'
  )

  _arguments -C \\
    '1:profile command:->profile_command' \\
    '*::arg:->profile_args'

  case $state in
    profile_command)
      _describe -t profile_cmds 'profile command' profile_cmds
      ;;
    profile_args)
      case $words[1] in
        init)
          _arguments \\
            '--from-profile[Copy an existing profile]:profile:_psbx_profiles' \\
            '--template[Use a shipped profile template]:template:(pi-in-ubuntu self-test copilot-in-ubuntu)' \\
            '--self-test[Use the lightweight self-test profile template]' \\
            '--copy-from-host[Copy host config directories into the new profile]' \\
            '--symlink-from-host[Symlink host config directories into the new profile]' \\
            '--set-as-default[Set this profile as the default]'
          ;;
        fork)
          _arguments '1:new-profile:'
          ;;
        delete)
          _arguments \\
            '(-f --force)'{-f,--force}'[Skip confirmation prompt]' \\
            '--all[Delete all profiles]' \\
            '1:profile:_psbx_profiles'
          ;;
        set-default)
          _arguments '1:profile:_psbx_profiles'
          ;;
        edit)
          _arguments \\
            '--file[Open a specific file]:file:(lima env)' \\
            '1:profile:_psbx_profiles'
          ;;
      esac
      ;;
  esac
}

_psbx_cache_commands() {
  local -a cache_cmds
  cache_cmds=(
    'list:List all profile caches'
    'ls:List all profile caches'
    'status:Show whether the current project already has a matching profile cache'
    'delete:Delete the matching profile cache for the current project'
  )

  _arguments -C \\
    '1:cache command:->cache_command' \\
    '*::arg:->cache_args'

  case $state in
    cache_command)
      _describe -t cache_cmds 'cache command' cache_cmds
      ;;
    cache_args)
      case $words[1] in
        status)
          _arguments \\
            '(-p --profile)'{-p,--profile}'[Use a specific profile]:profile:_psbx_profiles'
          ;;
        delete)
          _arguments \\
            '(-p --profile)'{-p,--profile}'[Use a specific profile]:profile:_psbx_profiles' \\
            '(-f --force)'{-f,--force}'[Skip confirmation prompt]' \\
            '--all[Delete all profile caches]'
          ;;
      esac
      ;;
  esac
}

_psbx() {
  local -a commands
  commands=(
    'up:Bring sandbox up: create, start, and enter in one step'
    'exec:Run a one-off command in the sandbox'
    'stop:Stop a running VM'
    'restart:Stop and then start the VM'
    'delete:Delete a VM (with confirmation)'
    'cache:Manage hidden profile caches (list, status, delete)'
    'profile:Manage profiles (init, fork, delete, list, edit, set-default)'
    'status:Show VM status, environment, and sync state for the current project'
    'list:List all psbx VMs'
    'ls:List all psbx VMs'
    'logs:Show cloud-init logs for the project VM and its profile cache VM'
    'completion:Generate shell completion scripts'
  )

  _arguments -C \\
    '(-y --yes)'{-y,--yes}'[Skip confirmation prompts]' \\
    '--version[Show version]' \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe -t commands 'psbx command' commands
      ;;
    args)
      case $words[1] in
        up)
          _arguments \\
            '(-p --profile)'{-p,--profile}'[Use a specific profile]:profile:_psbx_profiles' \\
            '--shell[Open a plain shell instead of default command]' \\
            '--only-create[Only create the VM]' \\
            '--only-recreate[Only recreate the VM]' \\
            '--only-start[Only start the VM]' \\
            '--force-recreate[Recreate the VM if it exists, create it otherwise]'
          ;;
        exec)
          _arguments \\
            '--shell[Open a plain shell instead of running a command]'
          ;;
        stop)
          _arguments \\
            '(-f --force)'{-f,--force}'[Force stop without graceful shutdown]'
          ;;
        restart)
          _arguments \\
            '(-f --force)'{-f,--force}'[Force stop without graceful shutdown]'
          ;;
        delete)
          _arguments \\
            '(-f --force)'{-f,--force}'[Skip confirmation prompt]' \\
            '--all-registered[Delete all registered VMs]' \\
            '1:vm-name:'
          ;;
        cache)
          _psbx_cache_commands
          ;;
        profile)
          _psbx_profile_commands
          ;;
        list|ls)
          _arguments '--prune[Remove stale entries]'
          ;;
        status)
          _arguments '--json[Output as JSON]'
          ;;
        completion)
          _arguments '1:shell:(bash zsh fish)'
          ;;
      esac
      ;;
  esac
}

compdef _psbx psbx
`;

const FISH_COMPLETION = `# psbx fish completion
#
# Installation:
#
#   psbx completion fish > ~/.config/fish/completions/psbx.fish

# Helper: list profile names
function __psbx_profiles
  psbx profile list --plain 2>/dev/null
end

# Helper: check if 'profile' subcommand is active but no profile subcommand yet
function __psbx_needs_profile_subcmd
  set -l cmd (commandline -opc)
  test (count $cmd) -eq 2; and test "$cmd[2]" = "profile"
end

# Helper: check if profile subcommand matches
function __psbx_profile_subcmd
  set -l cmd (commandline -opc)
  test (count $cmd) -ge 3; and test "$cmd[2]" = "profile"; and test "$cmd[3]" = "$argv[1]"
end

function __psbx_needs_cache_subcmd
  set -l cmd (commandline -opc)
  test (count $cmd) -eq 2; and test "$cmd[2]" = "cache"
end

function __psbx_cache_subcmd
  set -l cmd (commandline -opc)
  test (count $cmd) -ge 3; and test "$cmd[2]" = "cache"; and test "$cmd[3]" = "$argv[1]"
end

# Disable file completions by default
complete -c psbx -f

# Global options
complete -c psbx -s y -l yes -d 'Skip confirmation prompts'

# Commands
complete -c psbx -n '__fish_use_subcommand' -a up -d 'Bring sandbox up: create, start, and enter in one step'
complete -c psbx -n '__fish_use_subcommand' -a exec -d 'Run a one-off command in the sandbox'
complete -c psbx -n '__fish_use_subcommand' -a stop -d 'Stop a running VM'
complete -c psbx -n '__fish_use_subcommand' -a restart -d 'Stop and then start the VM'
complete -c psbx -n '__fish_use_subcommand' -a delete -d 'Delete a VM (with confirmation)'
complete -c psbx -n '__fish_use_subcommand' -a cache -d 'Manage hidden profile caches (list, status, delete)'
complete -c psbx -n '__fish_use_subcommand' -a profile -d 'Manage profiles (init, fork, delete, list, edit, set-default)'
complete -c psbx -n '__fish_use_subcommand' -a status -d 'Show VM status, environment, and sync state for the current project'
complete -c psbx -n '__fish_use_subcommand' -a list -d 'List all psbx VMs'
complete -c psbx -n '__fish_use_subcommand' -a ls -d 'List all psbx VMs'
complete -c psbx -n '__fish_use_subcommand' -a logs -d 'Show cloud-init logs for the project VM and its profile cache VM'
complete -c psbx -n '__fish_use_subcommand' -a completion -d 'Generate shell completion scripts'

# profile subcommands
complete -c psbx -n '__psbx_needs_profile_subcmd' -a init -d 'Initialize a psbx profile'
complete -c psbx -n '__psbx_needs_profile_subcmd' -a fork -d 'Snapshot the current project VM into a new profile and rebase the VM onto it'
complete -c psbx -n '__psbx_needs_profile_subcmd' -a delete -d 'Delete a profile'
complete -c psbx -n '__psbx_needs_profile_subcmd' -a list -d 'List all profiles'
complete -c psbx -n '__psbx_needs_profile_subcmd' -a ls -d 'List all profiles'
complete -c psbx -n '__psbx_needs_profile_subcmd' -a set-default -d 'Set the default profile'
complete -c psbx -n '__psbx_needs_profile_subcmd' -a edit -d 'Open a profile in \\$EDITOR'

# profile init options
complete -c psbx -n '__psbx_profile_subcmd init' -l from-profile -d 'Copy an existing profile' -r -a '(__psbx_profiles)'
complete -c psbx -n '__psbx_profile_subcmd init' -l template -d 'Use a shipped profile template (pi-in-ubuntu, self-test, copilot-in-ubuntu)' -r -a 'pi-in-ubuntu self-test copilot-in-ubuntu'
complete -c psbx -n '__psbx_profile_subcmd init' -l self-test -d 'Use the lightweight self-test profile template'
complete -c psbx -n '__psbx_profile_subcmd init' -l copy-from-host -d 'Copy host config directories into the new profile'
complete -c psbx -n '__psbx_profile_subcmd init' -l symlink-from-host -d 'Symlink host config directories into the new profile'

complete -c psbx -n '__psbx_profile_subcmd init' -l set-as-default -d 'Set this profile as the default'

# profile delete options
complete -c psbx -n '__psbx_profile_subcmd delete' -s f -l force -d 'Skip confirmation prompt'
complete -c psbx -n '__psbx_profile_subcmd delete' -l all -d 'Delete all profiles'
complete -c psbx -n '__psbx_profile_subcmd delete' -a '(__psbx_profiles)' -d 'Profile name'

# profile set-default options
complete -c psbx -n '__psbx_profile_subcmd set-default' -a '(__psbx_profiles)' -d 'Profile name'

# profile edit options
complete -c psbx -n '__psbx_profile_subcmd edit' -l file -d 'Open a specific file' -r -a 'lima env'
complete -c psbx -n '__psbx_profile_subcmd edit' -a '(__psbx_profiles)' -d 'Profile name'

# cache subcommands
complete -c psbx -n '__psbx_needs_cache_subcmd' -a list -d 'List all profile caches'
complete -c psbx -n '__psbx_needs_cache_subcmd' -a ls -d 'List all profile caches'
complete -c psbx -n '__psbx_needs_cache_subcmd' -a status -d 'Show whether the current project already has a matching profile cache'
complete -c psbx -n '__psbx_needs_cache_subcmd' -a delete -d 'Delete the matching profile cache for the current project'
complete -c psbx -n '__psbx_cache_subcmd status' -s p -l profile -d 'Use a specific profile' -r -a '(__psbx_profiles)'
complete -c psbx -n '__psbx_cache_subcmd delete' -s p -l profile -d 'Use a specific profile' -r -a '(__psbx_profiles)'
complete -c psbx -n '__psbx_cache_subcmd delete' -s f -l force -d 'Skip confirmation prompt'
complete -c psbx -n '__psbx_cache_subcmd delete' -l all -d 'Delete all profile caches'

# up options
complete -c psbx -n '__fish_seen_subcommand_from up' -s p -l profile -d 'Use a specific profile' -r -a '(__psbx_profiles)'
complete -c psbx -n '__fish_seen_subcommand_from up' -l shell -d 'Open a plain shell instead of default command'
complete -c psbx -n '__fish_seen_subcommand_from up' -l only-create -d 'Only create the VM'
complete -c psbx -n '__fish_seen_subcommand_from up' -l only-recreate -d 'Only recreate the VM'
complete -c psbx -n '__fish_seen_subcommand_from up' -l only-start -d 'Only start the VM'
complete -c psbx -n '__fish_seen_subcommand_from up' -l force-recreate -d 'Recreate the VM if it exists, create it otherwise'

# stop options
complete -c psbx -n '__fish_seen_subcommand_from stop' -s f -l force -d 'Force stop without graceful shutdown'

# restart options
complete -c psbx -n '__fish_seen_subcommand_from restart' -s f -l force -d 'Force stop without graceful shutdown'

# exec options
complete -c psbx -n '__fish_seen_subcommand_from exec' -l shell -d 'Open a plain shell instead of running a command'

# delete options
complete -c psbx -n '__fish_seen_subcommand_from delete' -s f -l force -d 'Skip confirmation prompt'
complete -c psbx -n '__fish_seen_subcommand_from delete' -l all-registered -d 'Delete all registered VMs'

# list options
complete -c psbx -n '__fish_seen_subcommand_from list ls' -l prune -d 'Remove stale entries'

# status options
complete -c psbx -n '__fish_seen_subcommand_from status' -l json -d 'Output as JSON'

# completion options
complete -c psbx -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish' -d 'Shell type'
`;

type SupportedShell = 'bash' | 'zsh' | 'fish';

const SHELLS: Record<SupportedShell, string> = {
  bash: BASH_COMPLETION,
  zsh: ZSH_COMPLETION,
  fish: FISH_COMPLETION,
};

function isSupportedShell(shell: string): shell is SupportedShell {
  return shell === 'bash' || shell === 'zsh' || shell === 'fish';
}

export async function completion(shell: string | undefined): Promise<void> {
  try {
    if (!shell) {
      // Auto-detect from $SHELL
      const loginShell = process.env.SHELL;
      if (loginShell) {
        const { basename } = await import('node:path');
        shell = basename(loginShell);
      }
    }

    if (!shell) {
      console.error('Error: Could not detect shell. Please specify one: bash, zsh, or fish');
      console.error('Usage: psbx completion [bash|zsh|fish]');
      process.exit(1);
    }

    if (!isSupportedShell(shell)) {
      console.error(`Error: Unsupported shell '${shell}'. Supported: bash, zsh, fish`);
      process.exit(1);
    }

    const script = SHELLS[shell];
    process.stdout.write(script);
  } catch (err: unknown) {
    handleError(err);
  }
}
