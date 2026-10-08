import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UsersModule } from '../users/users.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PasswordReset, PasswordResetSchema } from './password-reset/password-reset.schema';
import { PasswordResetService } from './password-reset/password-reset.service';
import { PasswordResetController } from './password-reset/password-reset.controller';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    MailModule,
    NotificationsModule,
    // User: the password reset updates password and tokenVersion atomically.
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: PasswordReset.name, schema: PasswordResetSchema },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRATION')
        }
      })
    })
  ],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, PasswordResetService],
  controllers: [AuthController, PasswordResetController],
  exports: [AuthService, JwtAuthGuard]
})
export class AuthModule {}
