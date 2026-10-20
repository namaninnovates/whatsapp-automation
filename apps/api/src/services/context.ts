import type { BusinessHours } from '@wa/shared';
import { prisma } from '../db';
import { isBusinessOpen } from '../lib/hours';

export async function businessHoursOpenFor(orgId: string, at = new Date()): Promise<boolean> {
  const profile = await prisma.businessProfile.findUnique({ where: { organizationId: orgId } });
  if (!profile) return true;
  return isBusinessOpen(profile.businessHours as BusinessHours, profile.timezone, at);
}
