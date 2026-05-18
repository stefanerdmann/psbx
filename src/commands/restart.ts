import { stop } from './stop.ts';
import { up } from './up.ts';

interface RestartOptions {
  force?: boolean;
}

// ---------------------------------------------------------------------------
// pi-sandbox restart
//
// Alias for `pi-sandbox stop && pi-sandbox up --only-start`.
// ---------------------------------------------------------------------------

export async function restart(options: RestartOptions = {}): Promise<void> {
  await stop(options);
  await up({ onlyStart: true });
}
