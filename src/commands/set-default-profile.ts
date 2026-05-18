import { setDefaultProfile } from '../config.ts';
import { handleError } from './helpers.ts';

// ---------------------------------------------------------------------------
// pi-sandbox profile set-default <name>
//
// Sets the default profile used when --profile is not specified.
// ---------------------------------------------------------------------------

export async function setDefault(profileName: string | undefined): Promise<void> {
  try {
    if (!profileName) {
      throw new Error('Profile name is required. Usage: pi-sandbox profile set-default <name>');
    }
    setDefaultProfile(profileName);
    console.log(`Default profile set to "${profileName}".`);
  } catch (err: unknown) {
    handleError(err);
  }
}
