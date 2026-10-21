import { ApiProperty } from '@nestjs/swagger';

export class UserPayload {
  @ApiProperty() id: string;
  @ApiProperty() email: string | null;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string | null;
  @ApiProperty() avatarUrl: string | null;
  @ApiProperty() status: string;
  @ApiProperty() createdAt: Date;
}

export class RolePayload {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
}

export class MembershipPayload {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() status: string;
  @ApiProperty() joinedAt: Date;
  @ApiProperty() roles: RolePayload[];
}

export class TenantPayload {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty() currencyCode: string;
  @ApiProperty() timezone: string;
}

export class TenantMembershipPayload {
  @ApiProperty() id: string;
  @ApiProperty() status: string;
  @ApiProperty() joinedAt: Date;
  @ApiProperty() tenant: TenantPayload;
  @ApiProperty({ type: [RolePayload] }) roles: RolePayload[];
}

export class AuthResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() user: UserPayload;
  @ApiProperty({ type: [TenantMembershipPayload] }) memberships: TenantMembershipPayload[];
}
