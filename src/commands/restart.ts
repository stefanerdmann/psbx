import { stop } from './stop.ts';
import { up } from './up.ts';

export const DESCRIPTION = 'Stop and then start the VM (without re-entering the shell)';

interface RestartOptions {
  force?: boolean;
}

export async function restart(options: RestartOptions = {}): Promise<void> {
  await stop(options);
  await up({ onlyStart: true });
}
