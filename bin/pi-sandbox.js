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
  .version('0.1.0');

program
  .command('create')
  .description('Create a new VM for the current project directory')
  .action(create);

program
  .command('enter')
  .description('Enter the VM shell (auto-starts if stopped)')
  .action(enter);

program
  .command('start')
  .description('Start a stopped VM')
  .action(start);

program
  .command('stop')
  .description('Stop a running VM')
  .action(stop);

program
  .command('delete')
  .description('Delete the VM (with confirmation)')
  .action(del);

program
  .command('recreate')
  .description('Delete and recreate the VM (applies config changes)')
  .action(recreate);

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
