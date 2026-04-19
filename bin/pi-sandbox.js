#!/usr/bin/env node

import { Command } from 'commander';
import { create } from '../src/commands/create.js';
import { enter } from '../src/commands/enter.js';
import { start } from '../src/commands/start.js';
import { stop } from '../src/commands/stop.js';
import { del } from '../src/commands/delete.js';
import { recreate } from '../src/commands/recreate.js';
import { status } from '../src/commands/status.js';
import { list } from '../src/commands/list.js';
import { logs } from '../src/commands/logs.js';
import { init } from '../src/commands/init.js';

const program = new Command();

program
  .name('pi-sandbox')
  .description('Manage per-project Lima VMs for the pi coding agent')
  .version('0.2.0');

// Helper to add --profile option to lifecycle commands
function withProfile(cmd) {
  return cmd.option('-p, --profile <name>', 'Use a specific config profile');
}

withProfile(program.command('create'))
  .description('Create a new VM for the current project directory')
  .action((options) => create(options));

withProfile(program.command('enter'))
  .description('Enter the VM shell (auto-starts if stopped)')
  .action((options) => enter(options));

withProfile(program.command('start'))
  .description('Start a stopped VM')
  .action((options) => start(options));

withProfile(program.command('stop'))
  .description('Stop a running VM')
  .action((options) => stop(options));

withProfile(program.command('delete'))
  .description('Delete the VM (with confirmation)')
  .action((options) => del(options));

withProfile(program.command('recreate'))
  .description('Delete and recreate the VM (applies config changes)')
  .action((options) => recreate(options));

program
  .command('status')
  .description('Show VM status for the current project')
  .action(status);

program
  .command('list')
  .description('List all pi-sandbox VMs')
  .action(list);

program
  .command('logs')
  .description('Show VM provisioning logs')
  .action(logs);

program
  .command('init')
  .description('Initialize pi-sandbox configuration')
  .action(init);

program.parse();
