import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { currentTokenVersion } from '../auth.service';

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  // Token version (spec 0007); absent on tokens issued before it existed.
  tv?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private usersService: UsersService
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');

    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret,
      ignoreExpiration: false
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.userId);

    // A password reset since this token was issued revokes it (AC-9).
    if ((payload.tv ?? 0) !== currentTokenVersion(user)) {
      throw new UnauthorizedException('Session expirée, reconnectez-vous');
    }

    return user;
  }
}
