import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DevicesService } from './devices.service';
import { NotificationsService } from './notifications.service';
import { PushSender } from './push-sender';
import { FcmClient } from './fcm.client';
import {
  InboxQueryDto,
  RegisterDeviceDto,
  UnregisterDeviceDto,
  UpdatePrefsDto,
} from './dto/notifications.dto';

interface AuthedRequest {
  user: { _id: Types.ObjectId; role: string };
}

// Push notifications (spec 0008): devices, preferences, inbox, admin test.
// Every route only touches the caller's own data.
@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@ApiResponse({ status: 401, description: 'Non authentifié' })
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly devices: DevicesService,
    private readonly notifications: NotificationsService,
    private readonly sender: PushSender,
    private readonly fcm: FcmClient,
  ) {}

  @ApiOperation({
    summary: 'Enregistrer ce téléphone pour les notifications',
    description:
      'À appeler après la connexion et à chaque renouvellement du jeton FCM. Un même jeton n’est jamais dupliqué ; s’il appartenait à un autre compte, il passe au compte connecté. 10 appareils au plus par compte, les plus anciens sont retirés.',
  })
  @ApiResponse({ status: 200, description: 'Appareil enregistré' })
  @ApiResponse({ status: 400, description: 'Jeton ou plateforme invalide' })
  @Put('devices')
  async registerDevice(
    @Request() req: AuthedRequest,
    @Body() dto: RegisterDeviceDto,
  ) {
    const device = await this.devices.register(req.user._id, dto);
    return { message: 'Device registered', device };
  }

  @ApiOperation({
    summary: 'Retirer ce téléphone (déconnexion)',
    description:
      'Corps `{ token }`. Répond 200 même si le jeton n’existe pas ou appartient à un autre compte (rien n’est alors modifié).',
  })
  @ApiResponse({ status: 200, description: 'Appareil retiré' })
  @ApiResponse({ status: 400, description: 'Jeton manquant' })
  @Delete('devices')
  async unregisterDevice(
    @Request() req: AuthedRequest,
    @Body() dto: UnregisterDeviceDto,
  ) {
    await this.devices.unregister(req.user._id, dto.token);
    return { message: 'Device removed' };
  }

  @ApiOperation({
    summary: 'Réglages des notifications',
    description:
      'Quatre interrupteurs, tous activés par défaut : newEpisodes, newSeries, premium, payment.',
  })
  @ApiResponse({ status: 200, description: 'Réglages' })
  @Get('preferences')
  async getPreferences(@Request() req: AuthedRequest) {
    return this.notifications.getPrefs(req.user._id);
  }

  @ApiOperation({
    summary: 'Modifier les réglages des notifications',
    description:
      'Envoyer un ou plusieurs booléens parmi newEpisodes, newSeries, premium, payment. Répond avec les quatre valeurs.',
  })
  @ApiResponse({ status: 200, description: 'Réglages à jour' })
  @ApiResponse({
    status: 400,
    description: 'Valeur non booléenne ou corps vide',
  })
  @Patch('preferences')
  async updatePreferences(
    @Request() req: AuthedRequest,
    @Body() dto: UpdatePrefsDto,
  ) {
    return this.notifications.updatePrefs(req.user._id, dto);
  }

  @ApiOperation({
    summary: 'Boîte de réception',
    description:
      'Notifications des 30 derniers jours, les plus récemment mises à jour d’abord, avec le nombre de non lues.',
  })
  @ApiResponse({ status: 200, description: 'Liste paginée' })
  @Get()
  async inbox(@Request() req: AuthedRequest, @Query() query: InboxQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const result = await this.notifications.list(req.user._id, page, limit);
    return {
      total: result.total,
      page,
      limit,
      unread: result.unread,
      notifications: result.notifications,
    };
  }

  @ApiOperation({ summary: 'Tout marquer comme lu' })
  @ApiResponse({
    status: 200,
    description: 'Nombre de notifications mises à jour',
  })
  @HttpCode(HttpStatus.OK)
  @Post('read-all')
  async readAll(@Request() req: AuthedRequest) {
    const updated = await this.notifications.markAllRead(req.user._id);
    return { message: 'All notifications read', updated };
  }

  @ApiOperation({
    summary: 'Envoyer une notification de test (admin)',
    description:
      'Pousse tout de suite une notification de test sur les appareils de l’admin connecté. Rien n’est ajouté à la boîte de réception.',
  })
  @ApiResponse({ status: 200, description: '{ devices, sent, failed }' })
  @ApiResponse({ status: 403, description: 'Réservé aux admins' })
  @ApiResponse({
    status: 503,
    description: 'Firebase non configuré (code PUSH_UNAVAILABLE)',
  })
  @HttpCode(HttpStatus.OK)
  @Post('test')
  async test(@Request() req: AuthedRequest) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
    if (this.fcm.mode() === 'off') {
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'PUSH_UNAVAILABLE',
          message: 'Service de notifications indisponible',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.sender.sendTest(req.user._id);
  }

  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  @ApiResponse({ status: 200, description: 'Notification lue' })
  @ApiResponse({ status: 404, description: 'Introuvable ou pas à toi' })
  @Patch(':id/read')
  async read(@Request() req: AuthedRequest, @Param('id') id: string) {
    const notification = await this.notifications.markRead(req.user._id, id);
    return { message: 'Notification read', notification };
  }
}
