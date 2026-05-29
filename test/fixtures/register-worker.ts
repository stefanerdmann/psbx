// Worker used by registry.test.ts to exercise cross-process registry locking.
// Registers a single VM named by argv[2] under PSBX_HOME.
import { registerVm } from '../../src/registry.ts';

const name = process.argv[2];
registerVm(name, { projectDir: `/tmp/${name}`, profile: 'p' });
