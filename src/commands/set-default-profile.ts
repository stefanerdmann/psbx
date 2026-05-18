import { setDefaultProfile } from '../config.ts';
import { handleError } from './helpers.ts';

// ---------------------------------------------------------------------------
// psbx profile set-default <name>
//
// Sets the default profile used when --profile is not specified.
// ---------------------------------------------------------------------------

export async function setDefault(profileName: string | undefined): Promise<void> {
  try {
    if (!profileName) {
      throw new Error('Profile name is required. Usage: psbx profile set-default <name>');
    }
    setDefaultProfile(profileName);
    console.log(`Default profile set to "${profileName}".`);
  } catch (err: unknown) {
    handleError(err);
  }
}
