import { PortalModule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

import { STAFF_POSITIONS } from './dto/staff.dto';

/**
 * Which portal each position belongs to.
 *
 * A school may only hold positions for the portals its plan tier grants, so
 * every position has to name the portal it serves. Without this the gate
 * could not tell a transport coordinator (TRANSPORT) from a librarian
 * (ACADEMIC).
 *
 * CUSTOM is the one position with no portal of its own: a school that buys
 * a custom position says which portal it is for when it creates it.
 */
export const POSITION_PORTALS: Record<
  (typeof STAFF_POSITIONS)[number],
  PortalModule | null
> = {
  FINANCIAL_AFFAIRS: PortalModule.FINANCIAL,
  ACADEMIC_AFFAIRS: PortalModule.ACADEMIC,
  RECEPTIONIST: PortalModule.RECEPTION,
  TRANSPORT_COORDINATOR: PortalModule.TRANSPORT,
  PRINCIPAL: PortalModule.ADMIN,
  JANITOR: PortalModule.ADMIN,
  LIBRARIAN: PortalModule.ACADEMIC,
  CUSTOM: null,
};

/** Human label for a position, used by the console and the admin portal. */
export const POSITION_LABELS: Record<(typeof STAFF_POSITIONS)[number], string> = {
  FINANCIAL_AFFAIRS: 'Financial Affairs',
  ACADEMIC_AFFAIRS: 'Academic Affairs',
  RECEPTIONIST: 'Receptionist',
  TRANSPORT_COORDINATOR: 'Transport Coordinator',
  PRINCIPAL: 'Principal',
  JANITOR: 'Janitor',
  LIBRARIAN: 'Librarian',
  CUSTOM: 'Custom',
};

/**
 * The positions a school may create, given the portals its tier grants.
 *
 * A school on a tier without the transport portal cannot create a transport
 * coordinator, so the option never appears and the server refuses it.
 */
export function allowedPositions(
  tierPortals: PortalModule[] | null | undefined,
): (typeof STAFF_POSITIONS)[number][] {
  // No licence (or a licence with no tier) means no tier restriction: the
  // school keeps the positions it always had.
  if (!tierPortals) return [...STAFF_POSITIONS];

  const allowed = STAFF_POSITIONS.filter((position) => {
    const portal = POSITION_PORTALS[position];
    // CUSTOM names its portal at creation time, so it is always offered.
    if (portal === null) return true;
    return tierPortals.includes(portal);
  });

  return allowed;
}

/** The portal a position serves, or the one the caller named for CUSTOM. */
export function portalForPosition(
  position: string,
  customPortal?: PortalModule | null,
): PortalModule | null {
  const portal =
    POSITION_PORTALS[position as (typeof STAFF_POSITIONS)[number]] ?? null;
  if (portal !== null) return portal;
  return customPortal ?? null;
}

/**
 * The portals a school's plan tier grants.
 *
 * A school with no licence (or a licence with no tier) is not restricted:
 * it keeps whatever positions it always had. The tier is what a school
 * pays for, so it is what decides which portals it may staff.
 */
export async function tierPortalsFor(
  prisma: PrismaService,
  tenantId: string,
): Promise<PortalModule[] | null> {
  const licence = await prisma.tenantLicense.findFirst({
    where: { tenantId, status: 'ACTIVE' },
    orderBy: { startedAt: 'desc' },
    select: { plan: { select: { includedModules: true } } },
  });
  if (!licence) return null;
  return licence.plan.includedModules;
}
