import { Controller, Post, Body, UseGuards, Get, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto, RefreshResponseDto } from './dto/auth-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({
    summary: 'Login',
    description: 'Authentifie un utilisateur et retourne un access token + refresh token.'
  })
  @ApiResponse({ status: 200, description: 'Connexion réussie', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Email ou mot de passe incorrect' })
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const { accessToken, refreshToken, user } = await this.authService.login(loginDto);

    return {
      message: 'Login successful',
      accessToken,
      refreshToken,
      user
    };
  }

  @ApiOperation({
    summary: 'Rafraîchir le token',
    description: 'Génère un nouvel access token à partir d\'un refresh token valide.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['refreshToken'],
      properties: {
        refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Nouveau token généré', type: RefreshResponseDto })
  @ApiResponse({ status: 401, description: 'Refresh token invalide ou expiré' })
  @Post('refresh')
  async refresh(@Body() body: { refreshToken: string }) {
    const { accessToken } = await this.authService.refresh(body.refreshToken);

    return {
      message: 'Token refreshed',
      accessToken
    };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Profil utilisateur connecté',
    description: 'Retourne les informations de l\'utilisateur authentifié via le token JWT.'
  })
  @ApiResponse({ status: 200, description: 'Profil récupéré avec succès' })
  @ApiResponse({ status: 401, description: 'Token manquant ou invalide' })
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return {
      message: 'Profile retrieved',
      user: req.user
    };
  }
}
