import {
  Controller,
  Post,
  Put,
  Delete,
  Body,
  Get,
  Param,
  Request,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import {
  RegisterResponseDto,
  UserDto,
  UsersListResponseDto,
} from './dto/user-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImageRoute, ImageUpload } from '../media/image-route.decorators';
import { toUserProfile } from './user-profile';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @ApiOperation({
    summary: 'Inscription',
    description:
      'Crée un nouveau compte utilisateur. Le rôle par défaut est `user`.',
  })
  @ApiResponse({
    status: 201,
    description: 'Compte créé avec succès',
    type: RegisterResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Données invalides (email déjà utilisé, champs manquants...)',
  })
  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    const user = await this.usersService.create(createUserDto);
    return {
      message: 'User registered successfully',
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
        subscription: user.subscription,
        createdAt: user.createdAt,
      },
    };
  }

  // Avatar routes (spec 0005): the user comes only from the token, never
  // from the URL, so nobody can touch another account's avatar.
  @ApiOperation({
    summary: 'Téléverser mon avatar',
    description:
      'Champ multipart "file" : JPEG, PNG ou WebP, 5 Mo au plus, au moins 200 × 200 px. Recadré en carré centré sur le visage (400 px au plus). Remplace et supprime l’ancien avatar.',
  })
  @ApiResponse({ status: 200, description: 'Avatar mis à jour' })
  @ApiResponse({ status: 409, description: 'L’avatar a changé entre temps' })
  @ImageRoute()
  @ImageUpload()
  @Put('me/avatar')
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req,
  ) {
    const user = await this.usersService.setAvatar(String(req.user._id), file);
    return { message: 'Avatar updated', user: toUserProfile(user) };
  }

  @ApiOperation({ summary: 'Retirer mon avatar' })
  @ApiResponse({ status: 200, description: 'Avatar retiré' })
  @ApiResponse({ status: 409, description: 'L’avatar a changé entre temps' })
  @ApiResponse({ status: 503, description: 'Service d’images indisponible' })
  @ImageRoute()
  @Delete('me/avatar')
  async removeAvatar(@Request() req) {
    const user = await this.usersService.removeAvatar(String(req.user._id));
    return { message: 'Avatar removed', user: toUserProfile(user) };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Obtenir un utilisateur par ID',
    description:
      "Retourne le profil complet d'un utilisateur via son identifiant MongoDB.",
  })
  @ApiParam({
    name: 'id',
    description: "ID MongoDB de l'utilisateur",
    example: '665f1b2c3d4e5f6789abcdef',
  })
  @ApiResponse({
    status: 200,
    description: 'Utilisateur trouvé',
    type: UserDto,
  })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 404, description: 'Utilisateur introuvable' })
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findById(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    return toUserProfile(user);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Lister tous les utilisateurs',
    description:
      'Retourne la liste complète des utilisateurs (usage admin recommandé).',
  })
  @ApiResponse({
    status: 200,
    description: 'Liste des utilisateurs',
    type: UsersListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll() {
    const users = await this.usersService.findAll();
    return {
      count: users.length,
      users: users.map((user) => ({
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
      })),
    };
  }
}
