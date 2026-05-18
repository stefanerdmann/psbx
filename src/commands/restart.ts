import { stop } from './stop.ts';
import { up } from './up.ts';

interface RestartOptions {
  force?: boolean;
}

// ---------------------------------------------------------------------------
// psbx restart
//
// Alias for `psbx stop && psbx up --only-start`.
// ---------------------------------------------------------------------------

export async function restart(options: RestartOptions = {}): Promise<void> {
  await stop(options);
  await up({ onlyStart: true });
}
