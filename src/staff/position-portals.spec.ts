import { PortalModule } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

import {
  allowedPositions,
  POSITION_PORTALS,
  portalForPosition,
  tierPortalsFor,
} from './position-portals';

function buildPrisma(includedModules: PortalModule[] | null) {
  return {
    tenantLicense: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          includedModules
            ? { plan: { includedModules } }
            : null,
        ),
    },
  } as unknown as PrismaService;
}

describe('POSITION_PORTALS', () => {
  it('gives every fixed position a portal', () => {
    expect(POSITION_PORTALS.FINANCIAL_AFFAIRS).toBe(PortalModule.FINANCIAL);
    expect(POSITION_PORTALS.ACADEMIC_AFFAIRS).toBe(PortalModule.ACADEMIC);
    expect(POSITION_PORTALS.RECEPTIONIST).toBe(PortalModule.RECEPTION);
    expect(POSITION_PORTALS.TRANSPORT_COORDINATOR).toBe(PortalModule.TRANSPORT);
    expect(POSITION_PORTALS.PRINCIPAL).toBe(PortalModule.ADMIN);
  });

  it('leaves a custom position without a portal of its own', () => {
    expect(POSITION_PORTALS.CUSTOM).toBeNull();
    expect(portalForPosition('CUSTOM', PortalModule.TRANSPORT)).toBe(
      PortalModule.TRANSPORT,
    );
  });
});

describe('allowedPositions', () => {
  it('offers every position when the school has no plan tier', () => {
    const allowed = allowedPositions(null);
    expect(allowed).toContain('TRANSPORT_COORDINATOR');
    expect(allowed).toContain('FINANCIAL_AFFAIRS');
  });

  it('hides the positions of a portal the tier does not grant', () => {
    const allowed = allowedPositions([
      PortalModule.ADMIN,
      PortalModule.ACADEMIC,
      PortalModule.TEACHER,
      PortalModule.STUDENT,
    ]);

    expect(allowed).toContain('ACADEMIC_AFFAIRS');
    expect(allowed).toContain('PRINCIPAL');
    expect(allowed).not.toContain('FINANCIAL_AFFAIRS');
    expect(allowed).not.toContain('TRANSPORT_COORDINATOR');
    expect(allowed).not.toContain('RECEPTIONIST');
  });

  it('offers a custom position whatever the tier, because it names its portal later', () => {
    expect(allowedPositions([PortalModule.ADMIN])).toContain('CUSTOM');
  });
});

describe('tierPortalsFor', () => {
  it('reads the portals from the school licence', async () => {
    const prisma = buildPrisma([PortalModule.ADMIN, PortalModule.ACADEMIC]);

    const portals = await tierPortalsFor(prisma, 'tenant-1');

    expect(portals).toEqual([PortalModule.ADMIN, PortalModule.ACADEMIC]);
  });

  it('returns null when the school has no licence', async () => {
    const prisma = buildPrisma(null);

    expect(await tierPortalsFor(prisma, 'tenant-1')).toBeNull();
  });
});
