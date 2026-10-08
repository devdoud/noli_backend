import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

// The user fields login and the password reset answer with.
export interface AuthUser {
  id: unknown;
  email: string;
  username: string;
  role: string;
  subscription: unknown;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

// The token version a user's tokens must carry (spec 0007 AC-9). Accounts
// and tokens from before the field existed both read as 0.
export function currentTokenVersion(user: { tokenVersion?: number }): number {
  return user.tokenVersion ?? 0;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService
  ) {}

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const { email, password } = loginDto;

    let user;
    try {
      user = await this.usersService.findByEmail(email);
    } catch (error) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await this.usersService.verifyPassword(
      password,
      user.password
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueTokens(user);
  }

  // A fresh token pair plus the public user fields, as login answers them.
  // Also used by the password reset (spec 0007 AC-8).
  issueTokens(user: any): AuthResponse {
    return {
      accessToken: this.createAccessToken(user),
      refreshToken: this.createRefreshToken(user),
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
        subscription: user.subscription
      }
    };
  }

private createAccessToken(user: any): string {
  const payload = {
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
    tv: currentTokenVersion(user)
  };

  return this.jwtService.sign(payload, {
    secret: this.configService.getOrThrow<string>('JWT_SECRET'),
    expiresIn: parseInt(this.configService.getOrThrow<string>('JWT_EXPIRATION'))
  });
}

private createRefreshToken(user: any): string {
  const payload = {
    userId: user._id.toString(),
    tv: currentTokenVersion(user)
  };

  return this.jwtService.sign(payload, {
    secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
    expiresIn: parseInt(this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRATION'))
  });
}

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET')
      });

      const user = await this.usersService.findById(payload.userId);

      // A password reset since this token was issued revokes it.
      if ((payload.tv ?? 0) !== currentTokenVersion(user)) {
        throw new UnauthorizedException();
      }

      const accessToken = this.createAccessToken(user);

      return { accessToken };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
