import { UserRole } from '@trinh-ky/shared';

export interface UserPrincipal {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId?: string | null;
  departmentId?: string | null;
}
