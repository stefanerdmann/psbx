import { setDefaultProfile } from '../config.ts';
import { handleError } from './helpers.ts';

export const DESCRIPTION = 'Set the default profile';

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
