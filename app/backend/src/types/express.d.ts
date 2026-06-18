import { AppRole } from '../auth/app-role.enum';

declare global {
  namespace Express {
    interface Request {
      user?: {
        role: AppRole;
        ngoId?: string | null;
        apiKeyId?: string;
        authType?: 'apiKey' | 'envApiKey';
        /** JWT subject claim, populated once token-based auth is wired up. */
        sub?: string;
        /** Generic user id, populated by alternate auth strategies. */
        id?: string;
        /** User email, populated by alternate auth strategies. */
        email?: string;
        /** Organization id, populated by alternate auth strategies. */
        orgId?: string;
      };
    }
  }
}
