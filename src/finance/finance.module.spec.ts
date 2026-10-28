jest.mock('../auth/auth.module', () => ({ AuthModule: class AuthModule {} }));

import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from './finance.module';

describe('FinanceModule wiring', () => {
  const imports: unknown[] = Reflect.getMetadata('imports', FinanceModule) ?? [];

  it('takes JwtService from AuthModule so socket tickets sign with the configured secret', () => {
    expect(imports).toContain(AuthModule);
  });

  it('never imports a bare JwtModule, whose empty options crash signAsync', () => {
    expect(imports).not.toContain(JwtModule);
  });
});
